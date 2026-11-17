# `piffero-plus` vs Oboe vs `@streamparser/json` vs `jsonpath-plus`

Full 11-scenario benchmark and parity comparison executed on the 200 MiB GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` elements generated in `os.tmpdir()` from [large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-parsers.js`](../../benchmarking/compare-parsers.js) and [`index.js`](../../benchmarking/index.js).

```bash
npm run benchmark:compare
npm run benchmark
```

## Extended 11-Scenario Results (`npm run benchmark:compare`)

| Scenario (matches extracted) | `piffero-plus` (stream) | `piffero-plus` (string) | Oboe | `@streamparser/json` | `jsonpath-plus` (in-memory) |
|---|---|---|---|---|---|
| Early file `$.[1].payload` (1) | 1.38 ms (723.24 ops/s) | **0.98 ms** (1023.85 ops/s) | 11.94 ms (83.75 ops/s) | 10.24 ms (97.69 ops/s) | 3308.25 ms (0.30 ops/s) |
| Mid file `$.[31341].payload` (1) | 642.83 ms (1.56 ops/s) | **603.39 ms** (1.66 ops/s) | 3240.89 ms (0.31 ops/s) | 1751.00 ms (0.57 ops/s) | 1568.75 ms (0.64 ops/s) |
| End file `$.[56754]...received_events_url` (1) | 1121.84 ms (0.89 ops/s) | **1118.06 ms** (0.89 ops/s) | 4302.49 ms (0.23 ops/s) | 3182.61 ms (0.31 ops/s) | 1973.14 ms (0.51 ops/s) |
| Root array elements `$[*]` (62,683) | 3828.98 ms (0.26 ops/s) | 3383.77 ms (0.30 ops/s) | 4704.17 ms (0.21 ops/s) | 3048.42 ms (0.33 ops/s) | **1729.92 ms** (0.58 ops/s) |
| Wildcard shallow `$[*].actor.login` (62,683) | 1428.23 ms (0.70 ops/s) | **1424.71 ms** (0.70 ops/s) | 4491.43 ms (0.22 ops/s) | 3518.47 ms (0.28 ops/s) | 1571.89 ms (0.64 ops/s) |
| Nested wildcard `$[*].payload.commits[*].author.email` (55,729) | 1612.35 ms (0.62 ops/s) | **1603.60 ms** (0.62 ops/s) | 4580.17 ms (0.22 ops/s) | 3780.32 ms (0.26 ops/s) | 1937.37 ms (0.52 ops/s) |
| Recursive descent `$..user.login` (23,715) | 2702.94 ms (0.37 ops/s) | 2723.73 ms (0.37 ops/s) | 4461.52 ms (0.22 ops/s) | N/A (unsupported) | **1813.73 ms** (0.55 ops/s) |
| Recursive + wildcard `$..commits[*].sha` (55,729) | 2777.92 ms (0.36 ops/s) | 2769.55 ms (0.36 ops/s) | 4495.93 ms (0.22 ops/s) | N/A (unsupported) | **1858.10 ms** (0.54 ops/s) |
| Existence filter vs duck-typing (7,725) | 1692.54 ms (0.59 ops/s) | 1678.32 ms (0.60 ops/s) | 4369.64 ms (0.23 ops/s) | N/A (unsupported) | **1594.54 ms** (0.63 ops/s) |
| Array slice early-exit `$[0:10:2]` (5) | 2.48 ms (403.23 ops/s) | **1.24 ms** (806.45 ops/s) | N/A (unsupported) | N/A (unsupported) | 2104.39 ms (0.48 ops/s) |
| Reverse array slice `$[10:0:-1]` (10) | 1077.44 ms (0.93 ops/s) | **1054.89 ms** (0.95 ops/s) | N/A (unsupported) | N/A (unsupported) | 1840.44 ms (0.54 ops/s) |

## Key Takeaways

- **Streaming vs in-memory (`jsonpath-plus`)**: `jsonpath-plus` must read and `JSON.parse()` the entire 200 MiB document into RAM before evaluating a query. On early-file queries (`$.[1].payload`), `piffero-plus` is **~3,376x faster** (`0.98 ms` vs `3308.25 ms`), and beats `jsonpath-plus` on mid-file (`603.39 ms` vs `1568.75 ms`, **~2.6x**), end-of-file point lookups (`1118.06 ms` vs `1973.14 ms`, **~1.8x**), shallow wildcards (`1424.71 ms` vs `1571.89 ms`), nested wildcards (`1603.60 ms` vs `1937.37 ms`), forward slices (`$[0:10:2]`: `1.24 ms` vs `2104.39 ms`, **~1,697x**), and reverse slices (`$[10:0:-1]`: `1054.89 ms` vs `1840.44 ms`, **~1.7x**), while closely tracking in-memory filters (`1678.32 ms` vs `1594.54 ms`) with bounded memory.
- **Safe nested filter traversal**: Where `jsonpath-plus` throws `TypeError` when an intermediate property in a filter path is missing (e.g. `@.address.city`), `piffero-plus` evaluates safely without crashing.
- **Streaming vs Oboe / `@streamparser/json`**: `piffero-plus` outperforms Oboe in **all 9 supported scenarios** (**~1.4x–12.2x faster**, with Oboe lacking native slices) and beats `@streamparser/json` in **5 of 6 supported scenarios** (**~2.4x–10.4x faster** on point lookups and selective wildcards, with `@streamparser/json` lacking `..`, `?()`, and `[start:end:step]` support altogether), even while the harness pays a `JSON.parse` round-trip on `piffero-plus`'s output.
- Verified in Jasmine parity suites: [`streamparserParitySpec.ts`](../../spec/piffero/streamparserParitySpec.ts) and [`jsonpathPlusParitySpec.ts`](../../spec/piffero/jsonpathPlusParitySpec.ts).
