# Internal Architecture & Performance Engineering

`piffero-plus` is designed around a single principle: **extract JSONPath matches directly from a byte stream with bounded memory and minimal CPU overhead**, while still offering full RFC 9535 semantics.

---

## 1. High-Level Processing Pipeline

```text
Input (PifferoInput):
 ├── In-memory JS Object / Array ──▶ evaluateInMemory() ──▶ JS Array or JSON ([...])
 ├── string / Buffer / Uint8Array ─▶ MasterHandler.parseSync() (direct CParser feed)
 └── Node.js Readable / Web ReadableStream (webStreamToNodeReadable)
         │  pipe() + backpressure (pause / resume) + reader.cancel() on early exit
         ▼
┌────────────────────────────────────────────────────────┐
│ CStream  (src/libs/clarinet/cstream.ts)                │
│  • Incremental SAX tokenizer (TypeScript Clarinet port)│
│  • Native StringDecoder for multi-byte UTF-8 chunks    │
│  • skipDecode bypasses UTF-8 decoding on skipped trees │
└───────┬────────────────────────────────────────────────┘
        │ SAX events: onopenobject / onkey / onvalue / oncloseobject / ...
        ▼
┌────────────────────────────────────────────────────────┐
│ MasterHandler  (src/handler/mastehandler.ts)           │
│  Routes compiled JsonPathStep[] via parse():           │
│   ├─ Fast-path: SingleStepHandler (simple linear paths)│
│   └─ Full engine: StreamingPathEngine (*, .., slices,  │
│      unions, scripts, complex filters, root $ refs,    │
│      and resultType: "path" | "pointer" | "all")       │
└───────┬────────────────────────────────────────────────┘
        │ Raw JSON tokens / formatted paths buffered in chunks
        ▼
  Output Modes:
   ├─ findByPath()    → 4 KiB chunks → Readable stream ([...])
   ├─ findAsString()  → 16 KiB joins → callback(result, err)
   ├─ findAsPromise() → Promise<string>
   └─ query()         → any[] (synchronous JS values / paths)
```

---

## 2. Universal Input Routing & Dual-Engine Execution (`parse()` & `MasterHandler`)

When you invoke any `Piffero` method, [`parse()`](../src/handler/mastehandler.ts) tokenizes the query with [`tokenizeJsonPath()`](../src/handler/jsonpathEngine.ts) (throwing `PifferoJsonPathError` immediately on syntax errors) and dispatches by input type and query complexity:

1. **In-Memory JS Objects & Arrays (`evaluateInMemory`)**: If `input` is an already-parsed JavaScript object or array, `Piffero` bypasses JSON tokenization altogether and evaluates `JsonPathStep[]` directly against the object graph via [`evaluateInMemory()`](../src/handler/jsonpathEngine.ts), reusing cached filter ASTs in `ConditionEval`.
2. **Synchronous `string` / `Buffer` / `Uint8Array` (`MasterHandler.parseSync`)**: When passed to `findAsString`, `findAsPromise`, or `query`, raw strings and buffers are fed directly into `CStream` synchronously without allocating a Node `Readable` wrapper or waiting for next-tick stream events.
3. **WHATWG Web `ReadableStream` (`webStreamToNodeReadable`)**: Web streams (such as `fetch().body`) are wrapped in a demand-driven `Readable` adapter that pulls from `reader.read()` with backpressure and invokes `reader.cancel()` on early exit.
4. **`SingleStepHandler` (Legacy Fast-Path)**: Used on streams/buffers when `resultType === "value"` and the query is a simple linear path without wildcards, recursive descent, negative indices, slices, unions, scripts, or complex filters (e.g., `$.employees[1].name`, `$.a.b.c`).
5. **`StreamingPathEngine`**: Used whenever the query contains `*`, `..`, slices (`[start:end:step]`), heterogeneous or key unions, script expressions `(...)`, root-level array indexing, general RFC 9535 filters (`?` / `?()`), or `resultType !== "value"` (`"path"`, `"pointer"`, `"all"`).

---

## 3. Core Optimizations

### `CStream` & `skipDecode`
[`CStream`](../src/libs/clarinet/cstream.ts) is a `Writable` stream wrapping `CParser` (a TypeScript port of Clarinet) using Node's native `StringDecoder` so multi-byte UTF-8 sequences split across chunks are decoded safely.
- When `MasterHandler` or `StreamingPathEngine` enters an unmatched subtree (`skipDepth > 0`) and no active capture, array collector, or filter needs its contents, it sets `skipDecode = true`.
- While `skipDecode` is active, `CStream` scans JSON structural delimiters (`{`, `}`, `[`, `]`, `"`, `\`, `:`, `,`) without allocating or UTF-8 decoding string values inside skipped branches.

### `JsonValueCollector` (Zero-Deserialize Pass-Through)
Matched branches are captured by [`JsonValueCollector`](../src/handler/jsonpathEngine.ts), which reconstructs raw JSON tokens directly into output chunks without `JSON.parse()` → `JSON.stringify()` round-trips.

### `PrunedJsBuilder` (Static Projection for Filters)
Evaluating filters normally requires building a JavaScript value for candidate objects. For queries where a filter is followed by downstream path steps (e.g., `$[?@.payload.issue].payload.issue.number`), [`buildFilterProjection()`](../src/handler/jsonpathEngine.ts) statically analyzes:
1. All properties referenced by the filter's AST (`collectExprProjection`), and
2. All downstream property steps (`child` / `unionKeys`) needed after the filter passes.

[`PrunedJsBuilder`](../src/handler/jsonpathEngine.ts) then materializes **only** those fields into memory and skips every other heavy property in each candidate object (keeping `skipDecode` enabled inside pruned fields).

### `rootProjection` & `deferredRootFilters` (Forward `$` References)
When a filter references the root document (`$`, e.g., `$.items[?(@.price < $.maxPrice)]`), [`buildRootProjection()`](../src/handler/jsonpathEngine.ts) extracts only the root paths actually needed (`$.maxPrice`).
- If `$.maxPrice` appears **before** `$.items` in the stream, candidates are evaluated immediately as they arrive.
- If `$.maxPrice` appears **after** `$.items`, `StreamingPathEngine` queues candidate matches in `deferredRootFilters` and flushes them in selector order via `PendingSlot`s as soon as the projected root fields finish parsing—without buffering unrelated parts of the document.

### Early Stream Termination (`rootMaxIndex`)
At compile time, `StreamingPathEngine` computes `rootMaxIndex` (`getSelectorMaxPositiveIndex`) for deterministic root-level queries:
- Point indices (`$[1].payload` → `rootMaxIndex = 1`)
- Bounded positive slices (`$[0:10:2]` → `rootMaxIndex = 9`)
- Static positive scripts (`$[(1+1)]` → `rootMaxIndex = 2`)
- Bounded unions (`$[2, 0, 2, 1:3].id` → `rootMaxIndex = 2`)

Once `elementIndex > rootMaxIndex` and pending captures finish, `checkEarlyExit()` flushes results, calls `cStream.destroy()`, `stream.unpipe()`, and `stream.destroy()` (which also triggers `reader.cancel()` on Web `ReadableStream`s), stopping disk/network reads immediately.

### O(1) Streaming vs O(*k*) Ring Buffer (`tailKeep`)
- Forward positive slices (`$[0:10:2]`), strictly-increasing positive index unions (`$[0, 2, 5]`), and static scripts stream in **O(1)** memory per element without buffering the array.
- Tail expressions such as `$[(@.length-1)]`, `$[-2:]`, or reverse slices with negative `end` (`$[-1:-4:-1]`) set `tailKeep = k` on `ActiveArrayCollector`, maintaining only a sliding ring buffer of the last *k* raw JSON elements instead of the entire array.

### `ConditionEval` AST & I-Regexp Caching
[`ConditionEval`](../src/conditioneval/conditioneval.ts) compiles filter and script expressions with an embedded zero-dependency tokenizer and recursive-descent parser (`ExprParser`), caching compiled ASTs in `astCache`.
- `match()` and `search()` translate RFC 9485 I-Regexp patterns once and cache compiled `RegExp` objects in `iRegexpCache` (bounded at 1,024 entries).
- Missing properties resolve to the singleton symbol `NOTHING`, avoiding per-lookup nodelist allocations.

### Ordered Output via `PendingSlot`s & Lazy `O(depth)` Path Formatting (`resultType`)
Because heterogeneous unions (`$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]`) can match elements out of document order or multiple times, `StreamingPathEngine` assigns each selector branch a hierarchical `PendingSlot`. `flushPendingSlots()` emits completed slots strictly in selector order as soon as upstream dependencies settle.

When `resultType` is `"path"`, `"pointer"`, or `"all"`:
- `StreamingPathEngine` tracks the current object key (`currentKey`) and array index (`elementIndex`) in `frameStack` at `O(depth)` cost.
- Path segments are snapshotted (`snapshotCurrentPath`) **only** when a node matches or enters a candidate capture/filter, and formatted via [`formatNormalizedPath()`](../src/handler/jsonpathEngine.ts) (RFC 9535 §2.7) or [`formatJsonPointer()`](../src/handler/jsonpathEngine.ts) (RFC 6901).
- When `resultType` is `"path"` or `"pointer"` and a container (`{...}` or `[...]`) is matched as a terminal step, `StreamingPathEngine` emits the path immediately and skips decoding the entire container body via `skipDecode`.

---

## 4. Query Tips for Best Performance

1. **Be as specific as possible at the root**: `$.employees[*].name` enables `skipDecode` on unrelated root branches, whereas `$..name` must inspect keys at every depth.
2. **Prefer `findAsPromise()` / `findAsString()` for small outputs from streams**: When extracting a handful of records from a multi-hundred-MB file, avoiding the `Readable` stream wrapper gives ~0.45–0.55 ms response times on early matches.
3. **Prefer `Piffero.query()` for in-memory JS objects or buffers**: When the JSON is already parsed in memory, `Piffero.query(obj, path)` evaluates directly on the JS object graph (**~3.0x–3.6x faster** than `jsonpath-plus`).
4. **Prefer `findByPath()` for large streaming outputs**: When returning thousands of records (e.g., `$[*]`), pipe `findByPath()` directly to HTTP responses or `fs.createWriteStream()` so matched chunks flush incrementally with backpressure.
5. **Use bounded forward slices & indices when possible**: `$[0:100]` triggers automatic early termination; `$[-10:]` must scan to the end of the array (still using only an O(10) ring buffer).
