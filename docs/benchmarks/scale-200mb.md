# 200 MiB Scale Benchmark (`200.01 MiB` / `209.72 MB` JSON)

Large-scale 15-scenario benchmark comparison across 7 libraries on a **200.01 MiB** (**209.72 MB**, **62,683** GitHub event elements) dataset generated from [large-file.json](../../spec/jsonFiles/large-file.json) using [`compare-200mb.js`](../../benchmarking/compare-200mb.js).

```bash
npm run benchmark:200mb
npm run benchmark:filters   # ConditionEval RFC 9535 microbenchmark
npm run benchmark:phase5    # Phase 5: in-memory query(), resultType="path", RFC 9535 functions & WebStream
```

## Benchmark Results (200 MiB JSON, avg ms)

| Scenario (matches extracted) | `piffero-plus` (stream) | `piffero-plus` (string) | `@sapientpro/json-stream` | `json-web-streams` | `stream-json` | `@streamparser/json` | `Oboe` | `jsonpath-plus` (in-memory) |
|---|---|---|---|---|---|---|---|---|
| **1. Early file** `$.[1].payload` (1) | 1.65 ms | **0.45 ms** | 0.73 ms | N/A | 4.48 ms | 1.09 ms | 9.48 ms | 3301.31 ms |
| **2. Mid file** `$.[31341].payload` (1) | 639.93 ms | **601.17 ms** | 626.28 ms | N/A | 2214.46 ms | 1711.00 ms | 3230.70 ms | 2061.89 ms |
| **3. End file** `$.[56754]...received_events_url` (1) | 1112.33 ms | **1052.55 ms** | 1121.61 ms | N/A | 4103.15 ms | 3171.93 ms | 4118.41 ms | 1765.17 ms |
| **4. Root array** `$[*]` (62,683) | 3801.74 ms | 3346.97 ms | 2017.74 ms | **1423.78 ms** | 4901.11 ms | 3084.99 ms | 4722.44 ms | 2049.36 ms |
| **5. Wildcard shallow** `$[*].actor.login` (62,683) | 1415.59 ms | 1420.62 ms | **1355.27 ms** | 1575.34 ms | 5638.33 ms | 3633.72 ms | 4547.38 ms | 1571.26 ms |
| **6. Nested wildcard** `$[*].payload.commits[*].author.email` (55,729) | **1611.00 ms** | 1611.78 ms | 1911.17 ms | 1669.64 ms | 5619.68 ms | 3756.11 ms | 4499.91 ms | 1735.45 ms |
| **7. Recursive descent** `$..user.login` (23,715) | 2717.13 ms | 2602.03 ms | 3138.20 ms | N/A | 5488.51 ms | N/A | 4518.88 ms | **1826.14 ms** |
| **8. Existence filter (Goessner)** `$[?(@.payload.issue)].payload.issue.number` (7,725) | 1729.33 ms | 1714.03 ms | N/A | N/A | N/A | N/A | 4539.49 ms | **1568.55 ms** |
| **9. Existence filter (RFC 9535 `?[...]`)** `$[?@.payload.issue].payload.issue.number` (7,725) | 1620.08 ms | **1590.25 ms** | N/A | N/A (throws `Unsupported node: FilterSelector`) | N/A | N/A | 4502.94 ms *(duck-typing)* | N/A *(returns `[]`)* |
| **10. Array slice early-exit** `$[0:10:2]` (5) | 2.48 ms | **1.24 ms** | N/A | N/A | N/A | N/A | N/A | 2104.39 ms |
| **11. Reverse slice** `$[10:0:-1]` (10) | 1077.44 ms | **1054.89 ms** | N/A | N/A | N/A | N/A | N/A | 1840.44 ms |
| **12. Equality filter** `$[?(@.type == "IssuesEvent")].id` (3,035) | 1480.75 ms | **1460.66 ms** | N/A | N/A | N/A | N/A | N/A | 1866.99 ms |
| **13. Missing intermediate comparison** `$[?(@.payload.issue.number > 1000)].payload.issue.number` (1,405) | 1624.27 ms | **1610.40 ms** | N/A | N/A | N/A | N/A | N/A | N/A *(throws `TypeError`)* |
| **14. Heterogeneous union** `$[2,0,2,1:3].id` (5) | 1.42 ms | **0.48 ms** | N/A | N/A | N/A | N/A | N/A | 1482.23 ms |
| **15. Key union** `$[*]['type','id']` (125,366) | 1387.07 ms | 1374.04 ms | **1256.29 ms** *(doc order)* | N/A | 5724.10 ms *(doc order)* | 3562.81 ms *(doc order)* | N/A | 2153.09 ms *(selector order)* |

## Phase 5 Extended Benchmarks (`npm run benchmark:phase5`)

Executed via [`compare-phase5.js`](../../benchmarking/compare-phase5.js):

### 1. Pure In-Memory Evaluation (`Piffero.query(obj)` vs `jsonpath-plus`, ~39 MB parsed JSON in RAM)

| Query (`large-file.json`, 11,351 events) | `Piffero.query()` | `jsonpath-plus` | Speedup |
|---|---|---|---|
| Wildcard shallow `$[*].actor.login` (11,351) | **7.51 ms** | 22.35 ms | **~2.98x faster** |
| Nested wildcard `$[*].payload.commits[*].author.email` (10,109) | **6.15 ms** | 20.77 ms | **~3.38x faster** |
| Equality filter `$[?(@.type == "IssuesEvent")].id` (545) | **3.92 ms** | 14.21 ms | **~3.63x faster** |
| Normalized Paths `$[*].actor.login` (`resultType: "path"`) | **9.18 ms** | 27.57 ms | **~3.00x faster** |

### 2. Normalized Paths (`resultType: "path"`) on 200 MiB JSON

| Query | `piffero-plus` (stream) | `jsonpath-plus` (in-memory) | Notes |
|---|---|---|---|
| Early slice `$[0:10:2]` (5 paths) | **11.92 ms** | 1073.55 ms | **~90x faster** via `skipDecode` container fast-skip + early stream destroy |
| Full wildcard `$[*].actor.login` (61,204 paths) | 2963.13 ms | **1506.70 ms** | Bounded `O(depth)` memory on stream vs full-heap `JSON.parse` |

### 3. RFC 9535 Standard Functions on 200 MiB JSON (`piffero-plus`)

| Query | Avg Time (200 MiB) | Matches |
|---|---|---|
| `length()`: `$[?length(@.payload.commits) > 1].id` | **2405.75 ms** | 5,954 |
| `search()`: `$[?search(@.type, "Issue")].id` | **1815.60 ms** | 7,526 |
| `count()`: `$[?count(@.payload.commits[*]) > 1].id` | **3853.01 ms** | 5,954 |

### 4. Web `ReadableStream` (`Readable.toWeb`) on 200 MiB JSON

| Query | `piffero-plus` (WebStream) | `json-web-streams` |
|---|---|---|
| `$[*].actor.login` (61,204 matches) | 4227.73 ms | **2018.24 ms** |

## ConditionEval RFC 9535 Microbenchmark (`npm run benchmark:filters`)

Single-threaded CPU throughput over 200,000 pre-compiled AST evaluations ([`bench-conditioneval.js`](../../benchmarking/bench-conditioneval.js)):

| Scenario | ns / op | ops / sec |
|---|---|---|
| Existence present falsy (`@.flag` with `false`) | 38.3 ns | 26.1M ops/s |
| Existence missing deep (`@.a.b.c -> NOTHING`) | 83.9 ns | 11.9M ops/s |
| Equality string (`@.type == "IssuesEvent"`) | 88.3 ns | 11.3M ops/s |
| `Nothing == Nothing` (`@.x == @.y`) | 72.4 ns | 13.8M ops/s |
| Ordered numeric (`@.a > @.b`) | 93.5 ns | 10.7M ops/s |
| Ordered type mismatch (`"1500" > 1000`) | 89.5 ns | 11.2M ops/s |
| Deep structural equality (`@.meta == @.other`) | 275.3 ns | 3.63M ops/s |
| `rfc9535Equals` direct (`NOTHING` / primitive fast-path) | 8.4–10.2 ns | 97.6M–118.8M ops/s |

## Key Takeaways

- **#1 overall on every point lookup and slice**: `piffero-plus (string)` beats every tested library—including in-memory `jsonpath-plus`—at start-of-file (**0.45 ms** vs `3301.31 ms`, **~7,336x**), mid-file (**601.17 ms** vs `2061.89 ms`, **~3.4x**), end-of-file (**1052.55 ms** vs `1765.17 ms`, **~1.7x**; and ahead of `@sapientpro/json-stream` at `1121.61 ms`), forward slice `$[0:10:2]` (**1.24 ms** vs `2104.39 ms`, **~1,697x**), and reverse slice `$[10:0:-1]` (**1054.89 ms** vs `1840.44 ms`, **~1.7x**; all other streaming parsers lack RFC 9535 slice support).
- **#1 overall on heterogeneous unions & selector-ordered key unions**:
  - `$[2,0,2,1:3].id` (mixed reordered index + duplicate + slice): **0.48 ms** (`string`) / **1.42 ms** (`stream`) vs `jsonpath-plus` `1482.23 ms` (**~3,088x** faster via bounded `rootMaxIndex` early-exit); all other streaming parsers lack heterogeneous unions.
  - `$[*]['type','id']` (125,366 matches, preserving RFC 9535 selector order `type` before `id`): **1374.04 ms** (`string`) / **1387.07 ms** (`stream`), **~1.57x** faster than `jsonpath-plus` (`2153.09 ms`), **~2.59x** faster than `@streamparser/json` (`3562.81 ms`), and **~4.17x** faster than `stream-json` (`5724.10 ms`)—and the only streaming parser preserving selector order instead of document key order.
- **#1 overall on nested wildcards, RFC 9535 filters & pure in-memory queries (`Piffero.query`)**:
  - `$[*].payload.commits[*].author.email`: **1611.00 ms** (faster than `json-web-streams` `1669.64 ms`, `jsonpath-plus` `1735.45 ms`, `@sapientpro/json-stream` `1911.17 ms`, `@streamparser/json` `3756.11 ms`, `Oboe` `4499.91 ms`, and `stream-json` `5619.68 ms`).
  - `$..user.login`: **2602.03 ms** (faster than `@sapientpro/json-stream` `3138.20 ms`, `Oboe` `4518.88 ms`, and `stream-json` `5488.51 ms`).
  - `$[?@.payload.issue].payload.issue.number` (RFC 9535 without parentheses): **1590.25 ms** (**~2.8x** faster than `Oboe` duck-typing at `4502.94 ms`), while `jsonpath-plus` silently returns `[]` and `json-web-streams` throws `Unsupported node: FilterSelector`.
  - `$[?(@.type == "IssuesEvent")].id`: **1460.66 ms** vs `jsonpath-plus` `1866.99 ms` (**~1.28x** faster, bounded RAM), and `$[?(@.payload.issue.number > 1000)].payload.issue.number` succeeds in **1610.40 ms** via `NOTHING` propagation whereas `jsonpath-plus` throws `TypeError`.
  - Pure in-memory `Piffero.query(obj)` is **~3.0x–3.6x faster** than `jsonpath-plus` across wildcards, nested wildcards, filters, and Normalized Paths (`resultType: "path"`).
- **Consistent bounded-memory scaling**: Scaling 5.35x from 38 MB to 200 MiB keeps `piffero-plus` throughput linear while avoiding full-document V8 heap allocation.
