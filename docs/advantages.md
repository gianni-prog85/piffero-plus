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
| **Unicode `\uXXXX`, surrogates, I-JSON bounds, strict shorthand** | ✅ Compile-time validation and UTF-16 surrogate decoding | ⚠️ Partial (`sapientpro`/`json-web-streams` only escapes) | ❌ No `\uXXXX` decode in brackets or I-JSON range checks |

---

## 4. Zero Dependencies & Developer Experience

- **Zero runtime dependencies (`dependencies: {}`)**: Small install footprint, no transitive dependency vulnerabilities, and full bundled TypeScript types (`.d.ts`).
- **Three flexible APIs**:
  - `Piffero.findByPath(stream, jsonPath)` → `Readable` stream
  - `Piffero.findAsString(cb, stream, jsonPath)` → callback with full JSON array string
  - `Piffero.findAsPromise(stream, jsonPath)` → `Promise<string>`
- **Fail-fast & typed error separation**:
  - Invalid JSONPath expressions synchronously throw `PifferoJsonPathError` before touching the stream.
  - Malformed JSON inputs wrap into `PifferoError` and propagate cleanly across `'error'` stream events, callbacks, and Promise rejections.
- **Preserves `null` values**: Unlike parsers such as `bfj` (where `null` elements can act as EOF markers and disappear), `piffero-plus` preserves JSON `null` accurately everywhere.

---

## 5. Summary of Measured Speedups on 200 MiB JSON

- **Point lookups**:
  - Start (`$.[1].payload`): **0.45 ms** (**~7,336x** faster than `jsonpath-plus`, **~21x** faster than `Oboe`, **~10x** faster than `stream-json`).
  - Mid (`$.[31341].payload`): **601.17 ms** (**~3.4x** vs `jsonpath-plus`, **~3.7x** vs `stream-json`, **~5.4x** vs `Oboe`, **~52.8x** vs `bfj`).
  - End (`$.[56754]...`): **1052.55 ms** (**#1 overall**, ahead of `@sapientpro/json-stream` at `1121.61 ms` and `jsonpath-plus` at `1765.17 ms`).
- **Slices & heterogeneous unions**:
  - Forward slice (`$[0:10:2]`): **1.24 ms** (**~1,697x** faster than `jsonpath-plus`).
  - Heterogeneous union (`$[2,0,2,1:3].id`): **0.48 ms** (**~3,088x** faster than `jsonpath-plus`).
  - Key union in selector order (`$[*]['type','id']`, 125,366 matches): **1374.04 ms** (**~1.57x** faster than `jsonpath-plus`, **~2.59x** faster than `@streamparser/json`, **~4.17x** faster than `stream-json`).
- **Selective nested wildcards (`$[*].payload.commits[*].author.email`, 55,729 matches)**: **1611.00 ms** (**#1 overall** across all 7 libraries).
- **RFC 9535 filters (`$..`, `?@`, `==`, `>`)**: **1460–1610 ms** over 200 MiB with bounded RAM, beating in-memory `jsonpath-plus` (`1866.99 ms`) on equality filters and succeeding where `jsonpath-plus` silently returns `[]` or throws `TypeError`.

See also:
- [API Reference](./api-reference.md)
- [JSONPath Syntax & RFC 9535 Semantics Guide](./jsonpath-guide.md)
- [Internal Architecture & Performance Engineering](./architecture.md)
- [Full 200 MiB Scale Benchmark](./benchmarks/scale-200mb.md)
- [8-Library Feature Compatibility Matrix](./benchmarks/feature-matrix.md)
- [Streaming Parsers Comparison](./benchmarks/streaming-parsers.md)
- [General Comparison](./benchmarks/general-comparison.md)
- [`piffero-plus` vs `bfj`](./benchmarks/bfj-comparison.md)
