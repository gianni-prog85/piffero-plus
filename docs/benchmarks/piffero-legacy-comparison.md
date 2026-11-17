# `piffero-plus@1.0.0` vs Legacy `piffero@1.1.13` (npm)

Benchmark and correctness comparison on the **200 MiB** GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` elements generated in `os.tmpdir()` from [`spec/jsonFiles/large-file.json`](../../spec/jsonFiles/large-file.json)) comparing local **`piffero-plus@1.0.0`** (`./dist`) against the legacy **`piffero@1.1.13`** package installed directly from npm.

```bash
npm run benchmark:legacy
```

## Architecture & Packaging Differences

| Aspect | `piffero-plus@1.0.0` | `piffero@1.1.13` (npm) |
|---|---|---|
| **Runtime dependencies** | `0` (`dependencies: {}`) | `3` (`esprima`, `static-eval`, `underscore`) |
| **JSONPath engine** | `StreamingPathEngine` + compiled `ConditionEval` AST cache | `MasterHandler` recursive double-parsing + `split(".")` |
| **Output buffering** | `string[]` chunked `Readable` + backpressure (`pause`/`resume`) | `string +=` concatenation on `status.temp` |
| **Slice / Union strategy** | O(1) bounds, O(*k*) ring buffer, ordered `PendingSlot`s, early termination | Materialized `indexes[]`, `isbulk = true` disables early exit |
| **RFC 9535 compliance** | Full (`?`, `?()`, `..`, `*`, slices, heterogeneous unions, `NOTHING`, functions) | Partial (`$`, `.`, basic `[i]`, `[i,j]`, `[start:end:step]`, simple `==`/`===`) |

## Methodology

Executed via [`compare-piffero-npm.js`](../../benchmarking/compare-piffero-npm.js), running each `(engine, mode)` pair in an isolated Node.js subprocess (`--expose-gc --max-old-space-size=1536`) so `peakHeapMb` and `peakRssMb` measurements are uncontaminated across runs.

## Benchmark Results (200 MiB JSON)

| Scenario | `piffero-plus@1.0.0` (stream) | `piffero-plus@1.0.0` (string) | `piffero@1.1.13` npm (stream) | `piffero@1.1.13` npm (string) | Speedup & Correctness Notes |
|---|---|---|---|---|---|
| **1. Early file** `$.[1].payload` (1 match) | **1.56 ms** (`0.88 ms` med, `7.66 MB` heap) | **1.02 ms** (`0.89 ms` med, `7.57 MB` heap) | 6.26 ms (`7.44 ms` med, `9.38 MB` heap) | 1.16 ms (`0.95 ms` med, `9.21 MB` heap) | **4.0x faster** in stream mode; both valid (1 match) |
| **2. Nested array index** `$.[23].payload.commits[1].author` (1 match) | **7.31 ms** (`8.64 MB` heap) | **7.98 ms** (`8.46 MB` heap) | 12.00 ms (`10.14 MB` heap) | 15.36 ms (`9.55 MB` heap) | **1.6x–1.9x faster**; both valid (1 match) |
| **3. Single-element slice** `$.[1:2]` (1 match) | **2.51 ms** (`7.65 MB` heap, `130.82 MB` RSS) | **1.04 ms** (`7.59 MB` heap, `127.50 MB` RSS) | 5507.29 ms (`917.45 MB` heap, `1103.84 MB` RSS) | 5523.55 ms (`917.07 MB` heap, `1104.89 MB` RSS) | **~2,194x–5,311x faster**, **~120x lower heap** (`piffero@1.1.13` lacks slice early-exit & buffers unmatched tokens) |
| **4. Mid file** `$.[31341].payload` (1 match) | **655.65 ms** (`11.52 MB` heap) | **720.73 ms** (`11.45 MB` heap) | 1246.54 ms (`35.15 MB` heap) | 1237.68 ms (`35.10 MB` heap) | **~1.7x–1.9x faster**, **~3x lower heap** |
| **5. End file** `$.[56754].payload.issue.user.received_events_url` (1 match) | **1112.19 ms** (`11.55 MB` heap) | **1132.43 ms** (`10.72 MB` heap) | 2246.69 ms (`34.92 MB` heap) | 2226.72 ms (`35.02 MB` heap) | **~2.0x faster**, **~3x lower heap** |
| **6. Multi-element slice** `$.[0:10:2]` (5 matches) | **3.69 ms** (`8.12 MB` heap, valid: `5`) | **3.36 ms** (`8.01 MB` heap, valid: `5`) | 5513.69 ms (`916.81 MB` heap, **INVALID JSON**) | 5532.72 ms (`916.29 MB` heap, **INVALID JSON**) | **~1,494x–1,647x faster**, **~114x lower heap**; legacy omits `,` between objects (`}{`) |
| **7. Index union** `$.[0,2,4,6,8]` (5 matches) | **1.83 ms** (`8.05 MB` heap, valid: `5`) | **2.47 ms** (`7.73 MB` heap, valid: `5`) | 5002.57 ms (`916.84 MB` heap, **INVALID JSON**) | 4918.77 ms (`916.04 MB` heap, **INVALID JSON**) | **~1,991x–2,734x faster**, **~114x lower heap**; legacy emits malformed JSON (`}{`) |
| **8. Root equality filter** `$.[?(@.type==="IssuesEvent")]` (3,035 matches) | **2969.18 ms** (`34.64 MB` heap, valid: `3035`) | **3003.71 ms** (`98.17 MB` heap, valid: `3035`) | 2584.32 ms (`119.61 MB` heap, **INVALID JSON**) | 2694.41 ms (`190.81 MB` heap, **INVALID JSON**) | Legacy emits **INVALID JSON** (`9.09 MB` without commas) & uses **2x–3.5x more heap** |
| **9. Equality filter + projection** `$.[?(@.type==="IssuesEvent")].id` (3,035 matches) | **1452.88 ms** (`33.65 MB` heap, valid: `3035`) | **1487.13 ms** (`33.48 MB` heap, valid: `3035`) | 2695.74 ms (`35.56 MB` heap, valid: `3035`) | `ERROR: Unexpected end` (at 2645.10 ms) | **~1.86x faster** in stream mode (no double-parse + `PrunedJsBuilder`); legacy `string` mode crashes |
| **10. Wildcard** `$[*].actor.login` (62,683 matches) | **1359.09 ms** (`34.00 MB` heap, valid: `62683`) | **1374.01 ms** (`33.19 MB` heap, valid: `62683`) | 2111.45 ms (`0` matches — unsupported) | 2104.42 ms (`0` matches — unsupported) | Only `piffero-plus` supports `*` |
| **11. Recursive descent** `$..user.login` (23,715 matches) | **2539.38 ms** (`34.14 MB` heap, valid: `23715`) | **2543.13 ms** (`35.58 MB` heap, valid: `23715`) | 2153.54 ms (`0` matches — unsupported) | 2107.88 ms (`0` matches — unsupported) | Only `piffero-plus` supports `..` |
| **12. Existence filter** `$[?(@.payload.issue)].payload.issue.number` (7,725 matches) | **1739.57 ms** (`32.70 MB` heap, valid: `7725`) | **1735.14 ms** (`32.80 MB` heap, valid: `7725`) | `THROW: Invalid json path` | `THROW: Invalid json path` | Only `piffero-plus` supports existence & general filters |
| **13. Reverse slice** `$[10:0:-1]` (10 matches) | **1020.91 ms** (`10.44 MB` heap, valid: `10`) | **1030.02 ms** (`11.52 MB` heap, valid: `10`) | 4214.71 ms (`702.81 MB` heap, **INVALID JSON**) | 3629.22 ms (`678.84 MB` heap, **INVALID JSON**) | **~3.5x–4.1x faster**, **~60x–67x lower heap**; legacy dumps `72 MB` corrupted output (`end=0` bug) |
| **14. Heterogeneous union** `$[2,0,2,1:3].id` (5 matches) | **4.24 ms** (`7.80 MB` heap, valid: `5`) | **2.42 ms** (`8.03 MB` heap, valid: `5`) | 8.66 ms (wrong: `1` match) | 1.17 ms (wrong: `1` match) | Legacy drops 4 of 5 matches (`1:3` & duplicate/order lost) |

## Key Takeaways

1. **Up to ~5,311x faster with ~120x lower heap on slices & unions**: In `piffero@1.1.13`, `buildParsedPath` sets `isbulk = true` for every `[...]` bracket selector and accumulates unmatched tokens into `status.temp` across the entire 200 MiB document (`~917 MB` heap / `~1.10 GB` RSS). `piffero-plus@1.0.0` terminates immediately once bounded selectors complete (`1.04–3.69 ms`, `7.6–8.1 MB` heap).
2. **~1.7x–2.0x faster streaming throughput on mid/end-of-file lookups & projections**: `CStream` + `StreamingPathEngine` + `PrunedJsBuilder` cut raw scanning time nearly in half (`655.65 ms` vs `1246.54 ms` mid-file, `1112.19 ms` vs `2246.69 ms` end-file, `1452.88 ms` vs `2695.74 ms` filter+projection) while keeping V8 heap usage ~3x smaller (`~11.5 MB` vs `~35 MB`).
3. **Correctness & RFC 9535 compliance**: Legacy `piffero@1.1.13` emits malformed JSON missing commas (`}{`) on root-array slices (`$.[0:10:2]`), unions (`$.[0,2,4,6,8]`), and filters (`$.[?(@.type==="IssuesEvent")]`), crashes in `string` mode on filter+dot projections, dumps 72 MB of corrupted output on `$[10:0:-1]`, drops selectors on heterogeneous unions, and lacks `*`, `..`, and existence/general filters altogether—all fixed and RFC 9535-compliant in `piffero-plus@1.0.0`.
