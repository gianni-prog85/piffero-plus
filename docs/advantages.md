# Why Choose `piffero-plus`: Architecture, Capabilities & Performance Advantages

`piffero-plus` combines a **zero-dependency streaming SAX architecture** with **RFC 9535 JSONPath compliance**—closing the gap between fast but limited streaming path matchers and feature-rich in-memory evaluators that require loading the entire JSON document into RAM.

All measurements below come from reproducible suites in [`benchmarking/`](../benchmarking/) on a **200.01 MiB** (**209.72 MB**, **62,683** GitHub event records) dataset and are compared against 7 libraries (`@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `Oboe`, `bfj`, and `jsonpath-plus`).

---

## 1. Streaming Architecture & Bounded Memory

| Advantage | How `piffero-plus` Works | Concrete Benefit |
|---|---|---|
| **Larger-than-RAM processing** | Incremental `CStream` tokenizer (TypeScript Clarinet port) + [`StreamingPathEngine`](../src/handler/jsonpathEngine.ts) process chunks sequentially without buffering the whole input file. | Evaluates arbitrary-size JSON payloads in bounded V8 heap; avoids `JSON.parse()` out-of-memory failures and GC pauses. |
| **Automatic early stream termination** | Computes `rootMaxIndex` at query compile-time for deterministic point lookups (`$.[1].payload`), positive bounded slices (`$[0:10:2]`), and bounded unions (`$[2,0,2,1:3].id`), calling `destroy()`/`unpipe()` immediately once satisfied. | Extracts early records from 200 MiB in **0.45 ms** (`$.[1].payload`), **1.24 ms** (`$[0:10:2]`), and **0.48 ms** (`$[2,0,2,1:3].id`)—**~1,697x–7,336x** faster than in-memory `jsonpath-plus` without manual abort boilerplate. |
| **Native `Readable` output + backpressure** | `Piffero.findByPath()` returns a chunked Node.js `Readable` stream outputting a valid JSON array (`[...]`) directly, invoking `pause()`/`resume()` on the upstream source whenever downstream buffers fill. | Ready for `resultStream.pipe(res)` in HTTP APIs or pipelines without wrapping callbacks, `TransformStream` adapters, or post-serialization. |
| **Direct JSON pass-through** | Unmatched branches are ignored in place; matched subtrees flow straight to output chunks as raw JSON tokens (`JsonValueCollector`) without deserialize → re-stringify round-trips. | Minimal CPU and heap pressure per match compared to object-mode parsers (`@sapientpro/json-stream`, `@streamparser/json`, `Oboe`, `bfj`). |

---

## 2. Internal Speed Optimizations

`piffero-plus` avoids unnecessary work at every stage of parsing and evaluation:

- **`skipDecode` on skipped subtrees**: When the engine descends into branches that cannot match the current query steps (`skipDepth > 0`) and no active filter requires their fields, string UTF-8/escape decoding is bypassed completely.
- **`PrunedJsBuilder` for filter queries**: For filter selectors followed by downstream steps (e.g., `$[?@.payload.issue].payload.issue.number`), `piffero-plus` statically analyzes the AST + remaining path steps (`buildFilterProjection`) and materializes **only** the referenced fields, skipping large unrelated payloads inside every candidate object.
- **O(1) & Ring-Buffer Slice/Script Evaluation**:
  - Positive forward slices (`$[0:10:2]`), ordered positive index lists (`$[0, 2]`), and static scripts (`[(1+1)]`) stream in O(1) per element with zero array buffering.
  - Reverse slices (`$[10:0:-1]`, `$[-2:]`) and `@.length - k` scripts (`[(@.length-1)]`) keep only an O(*k*) ring buffer instead of collecting the entire array.
- **Zero-Allocation `ConditionEval` & `NOTHING` Sentinel**:
  - Filter and script expressions compile once to ASTs cached in memory (`astCache`)—zero runtime dependency on `esprima`/`static-eval`.
  - Missing JSON properties resolve to a singleton [`NOTHING`](../src/conditioneval/conditioneval.ts) symbol rather than allocating wrapper node arrays, running at **10.7M–26.1M ops/s** (and **97.6M–118.8M ops/s** on direct `rfc9535Equals` primitive/`NOTHING` checks).
- **Ordered Hierarchical `PendingSlot`s**: Heterogeneous or reordered unions (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['type', 'id']`) preserve exact selector order and duplicates with streaming slots while keeping ordered distinct index/key fast-paths free of array collection overhead.

---

## 3. RFC 9535 Standard Compliance (Unique Among Streaming Parsers)

Most streaming JSONPath libraries only support static child paths, wildcards, or simple `id`-style unions. `piffero-plus` implements full RFC 9535 semantics natively on streams:

| RFC 9535 Feature | `piffero-plus` | Other Streaming Parsers | In-Memory `jsonpath-plus` |
|---|---|---|---|
| **Parenless & parenthesized filters** (`?[?@.a]`, `?(@.a)`) | ✅ Full AST support | ❌ Unsupported (`Oboe` supports only `{prop}` duck-typing) | ❌ `?[...]` silently returns `[]` |
| **Existence vs falsy values** (`?@.v` with `false`, `0`, `""`, `null`) | ✅ Distinguishes present values from missing `NOTHING` | ❌ N/A | ❌ JS truthiness drops falsy values |
| **No-coercion equality (`==`, `!=`) & structural equality** | ✅ RFC 9535 strict equality (`"1" != 1`, deep object/array equality, `NOTHING == NOTHING`) | ❌ N/A | ❌ JS `==` coercion (`"1" == 1`) |
| **Type-safe ordered comparisons (`<`, `<=`, `>`, `>=`) & missing parents** | ✅ Compares only matching `number`/`string`; missing paths safely evaluate to `NOTHING` | ❌ N/A | ❌ Coerces types and throws `TypeError` on missing intermediates |
| **Complete slices (`[start:end:step]`, negative step, `step = 0`)** | ✅ Official RFC 9535 `Bounds` algorithm | ❌ Unsupported (`throws`) | ✅ Supported (in-memory only) |
| **Heterogeneous unions & order/duplicates** (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['b', 'a', 'b']`) | ✅ Mixed selectors, whitespace-safe, preserves selector order & duplicates | ❌ Key/index only, document order, no duplicates | ⚠️ Breaks with spaces (`$[2, 0, 2]`), drops key in key+filter union |
| **Full queries in filters & root `$` refs** (`?(@..price > 10)`, `?(@.tags[*])`, `$.maxPrice`) | ✅ Precompiled sub-queries, pruned `$` projection, deferred candidate queue | ❌ Unsupported | ✅ Requires full JSON in RAM |
| **RFC 9535 standard functions** (`length()`, `count()`, `match()`, `search()`, `value()`) | ✅ Compile-time type checks + cached RFC 9485 I-Regexp | ❌ Unsupported | ❌ Non-standard / missing |
| **Normalized Paths (§2.7) & JSON Pointer (`resultType`)** | ✅ `"value" \| "path" \| "pointer" \| "all"` with `O(depth)` lazy tracking & `skipDecode` container skip | ❌ Unsupported | ✅ Supported (in-memory only) |
| **Unicode `\uXXXX`, surrogates, I-JSON bounds, strict shorthand** | ✅ Compile-time validation and UTF-16 surrogate decoding | ⚠️ Partial (`sapientpro`/`json-web-streams` only escapes) | ❌ No `\uXXXX` decode in brackets or I-JSON range checks |

---

## 4. Zero Dependencies, Universal Inputs & Developer Experience

- **Zero runtime dependencies (`dependencies: {}`)**: Small install footprint, no transitive dependency vulnerabilities, and full bundled TypeScript types (`.d.ts`).
- **Universal input sources (`PifferoInput`)**:
  - Node.js `Readable` streams (`fs.createReadStream`, sockets, `zlib`).
  - WHATWG Web `ReadableStream` (`fetch(url).then(r => r.body)`) with automatic `reader.cancel()` on early exit.
  - Raw `string`, `Buffer`, and `Uint8Array` (processed synchronously via `MasterHandler.parseSync`).
  - In-memory JavaScript objects and arrays (evaluated directly via `evaluateInMemory`).
- **Four flexible APIs**:
  - `Piffero.findByPath(input, jsonPath?, options?)` → `Readable` stream
  - `Piffero.findAsString(cb, input, jsonPath?, options?)` → callback with full JSON array string
  - `Piffero.findAsPromise(input, jsonPath?, options?)` → `Promise<string>`
  - `Piffero.query(input, jsonPath?, options?)` → synchronous `any[]`
- **Fail-fast & typed error separation**:
  - Invalid JSONPath expressions synchronously throw `PifferoJsonPathError` before touching the stream.
  - Malformed JSON inputs wrap into `PifferoError` and propagate cleanly across `'error'` stream events, callbacks, Promise rejections, and `query()`.
- **Preserves `null` values**: Unlike parsers such as `bfj` (where `null` elements can act as EOF markers and disappear), `piffero-plus` preserves JSON `null` accurately everywhere.

---

## 5. Summary of Measured Speedups on 200 MiB JSON & In-Memory

- **Point lookups (200 MiB)**:
  - Start (`$.[1].payload`): **0.45 ms** (**~7,336x** faster than `jsonpath-plus`, **~21x** faster than `Oboe`, **~10x** faster than `stream-json`).
  - Mid (`$.[31341].payload`): **601.17 ms** (**~3.4x** vs `jsonpath-plus`, **~3.7x** vs `stream-json`, **~5.4x** vs `Oboe`, **~52.8x** vs `bfj`).
  - End (`$.[56754]...`): **1052.55 ms** (**#1 overall**, ahead of `@sapientpro/json-stream` at `1121.61 ms` and `jsonpath-plus` at `1765.17 ms`).
- **Slices, Normalized Paths & heterogeneous unions (200 MiB)**:
  - Forward slice (`$[0:10:2]`): **1.24 ms** (**~1,697x** faster than `jsonpath-plus`), and **11.92 ms** vs `1073.55 ms` (**~90x** faster) with `resultType: "path"`.
  - Heterogeneous union (`$[2,0,2,1:3].id`): **0.48 ms** (**~3,088x** faster than `jsonpath-plus`).
  - Key union in selector order (`$[*]['type','id']`, 125,366 matches): **1374.04 ms** (**~1.57x** faster than `jsonpath-plus`, **~2.59x** faster than `@streamparser/json`, **~4.17x** faster than `stream-json`).
- **Selective nested wildcards (`$[*].payload.commits[*].author.email`, 55,729 matches)**: **1611.00 ms** (**#1 overall** across all 7 libraries).
- **RFC 9535 filters (`$..`, `?@`, `==`, `>`)**: **1460–1610 ms** over 200 MiB with bounded RAM, beating in-memory `jsonpath-plus` (`1866.99 ms`) on equality filters and succeeding where `jsonpath-plus` silently returns `[]` or throws `TypeError`.
- **Pure in-memory JS objects (`Piffero.query` vs `jsonpath-plus`, ~39 MB parsed JSON)**: **~3.0x–3.6x faster** across `$[*].actor.login` (`7.51 ms` vs `22.35 ms`), nested wildcards (`6.15 ms` vs `20.77 ms`), equality filters (`3.92 ms` vs `14.21 ms`), and `resultType: "path"` (`9.18 ms` vs `27.57 ms`).

---

## 6. Head-to-Head: `piffero-plus` vs `jsonpath-plus`

`jsonpath-plus` is a widely used in-memory JSONPath evaluator, whereas `piffero-plus` evaluates JSONPath both directly over streams and synchronously on in-memory JS objects:

- **Memory & File Size Limits**: `jsonpath-plus` requires `JSON.parse()` on the entire payload in V8 heap before running a query (failing with OOM on files larger than available RAM). `piffero-plus` streams with bounded memory and zero runtime dependencies—and also provides `Piffero.query(obj)` when data is already in RAM.
- **Speed in Pure In-Memory Mode (`Piffero.query`)**: When querying an already-parsed JS object/array in RAM, `Piffero.query()` is **~3.0x–3.6x faster** than `jsonpath-plus` (`7.51 ms` vs `22.35 ms` on `$[*].actor.login`, `6.15 ms` vs `20.77 ms` on `$[*].payload.commits[*].author.email`, `3.92 ms` vs `14.21 ms` on `$[?(@.type == "IssuesEvent")].id`, and `9.18 ms` vs `27.57 ms` with `resultType: "path"`).
- **Speed on 200 MiB JSON Streams**:
  - `piffero-plus` is **~7,336x faster** on early-file lookups (`0.45 ms` vs `3301.31 ms`), **~3,088x faster** on bounded heterogeneous unions (`0.48 ms` vs `1482.23 ms`), **~1,697x faster** on bounded forward slices (`1.24 ms` vs `2104.39 ms`), **~90x faster** on early `resultType: "path"` slices (`11.92 ms` vs `1073.55 ms`), **~3.4x faster** on mid-file lookups (`601.17 ms` vs `2061.89 ms`), **~1.7x faster** on end-of-file lookups (`1052.55 ms` vs `1765.17 ms`) and reverse slices (`1054.89 ms` vs `1840.44 ms`), **~1.57x faster** on key unions (`1374.04 ms` vs `2153.09 ms`), and **~1.28x faster** on equality filters (`1460.66 ms` vs `1866.99 ms`).
  - Conversely, when the entire 200 MiB JSON fits in RAM and every record must be parsed and visited from raw text (`$[*]` at `2049.36 ms` vs `3346.97 ms`, `$..user.login` at `1826.14 ms` vs `2602.03 ms`, Goessner `$[?(@.payload.issue)]...` at `1568.55 ms` vs `1714.03 ms`), `JSON.parse()` + `jsonpath-plus` is faster on full-document raw-file scans at the cost of full V8 heap allocation.
- **RFC 9535 Correctness**:
  - `piffero-plus` evaluates parenless filters (`$[?@.payload.issue]`), propagates `NOTHING` safely when intermediate properties are missing, distinguishes falsy values (`false`, `0`, `""`, `null`) from missing keys, avoids JS `==` type coercion, handles whitespace and mixed selectors in unions (`$[2, 0, 2]`), decodes `\uXXXX` escapes in brackets, implements all 5 RFC 9535 functions (`length`, `count`, `match`, `search`, `value`), and outputs canonical RFC 9535 §2.7 Normalized Paths (`resultType: "path"`).
  - In the same scenarios, `jsonpath-plus` silently returns `[]` on `$[?@.payload.issue]`, throws `TypeError` on missing intermediate paths (`@.payload.issue.number > 1000`), coerces `"1" == 1`, breaks on spaces in `$[2, 0, 2]`, and drops keys in mixed key+filter unions.

See also:
- [API Reference](./api-reference.md)
- [JSONPath Syntax & RFC 9535 Semantics Guide](./jsonpath-guide.md)
- [Internal Architecture & Performance Engineering](./architecture.md)
- [Full 200 MiB Scale Benchmark](./benchmarks/scale-200mb.md)
- [8-Library Feature Compatibility Matrix](./benchmarks/feature-matrix.md)
- [Streaming Parsers Comparison](./benchmarks/streaming-parsers.md)
- [General Comparison](./benchmarks/general-comparison.md)
- [`piffero-plus` vs `bfj`](./benchmarks/bfj-comparison.md)
