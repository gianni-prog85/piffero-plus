# `piffero-plus` vs `bfj` (`v9.1.4`)

Full benchmark and parity comparison executed on the 200 MiB GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` elements generated in `os.tmpdir()` from [large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-bfj.js`](../../benchmarking/compare-bfj.js).

```bash
npm run benchmark:bfj
```

## Benchmark Results (200 MiB JSON)

| Scenario (matches extracted) | `piffero-plus` (stream) | `piffero-plus` (string) | `bfj` (`bfj.match`) |
|---|---|---|---|
| Early file `$.[1].payload` vs predicate (1) | 1.53 ms (653.52 ops/s) | **0.55 ms** (1803.63 ops/s) | 4.36 ms (229.32 ops/s) |
| Mid file `$.[31341].payload` vs predicate (1) | 592.90 ms (1.69 ops/s) | **582.10 ms** (1.72 ops/s) | 30760.45 ms (0.03 ops/s) |
| Root array elements `$[*]` vs depth-1 predicate (62,683) | 4066.55 ms (0.25 ops/s) | **3477.97 ms** (0.29 ops/s) | 59888.11 ms (0.02 ops/s) |
| Recursive key `$..login` vs key selector `'login'` (116,868) | 2630.14 ms (0.38 ops/s) | **2591.42 ms** (0.39 ops/s) | 59125.34 ms (0.02 ops/s) |
| Existence filter `$[?(@.payload.issue)]...` (7,725) | 1631.27 ms (0.61 ops/s) | **1627.22 ms** (0.61 ops/s) | N/A (unsupported) |

## Technical Notes & Limitations Observed in `bfj@9.1.4`

- **Throughput**: `bfj` prioritizes cooperative event-loop yielding over parsing speed. On the 200 MiB dataset, `piffero-plus` is **~7.9x faster** on early-file lookups (`0.55 ms` vs `4.36 ms`), **~17.2x faster** on root element scans (`3477.97 ms` vs `59888.11 ms`), **~22.8x faster** on recursive key extraction (`2591.42 ms` vs `59125.34 ms`), and **~52.8x faster** on mid-file lookups (`582.10 ms` vs `30760.45 ms`).
- **Broken `$.` JSONPath support on arrays**: `bfj.match` throws on `$.*` and `$..number`, and returns `0` matches on valid array JSONPath expressions such as `$.phoneNumbers[*].number`. Only plain key strings (`'login'`) and custom JS predicate functions `(key, value, depth) => boolean` work reliably.
- **Drops `null` values**: Because Node.js object-mode streams interpret `null` as EOF, `bfj.match` skips all JSON `null` values (e.g. `$..null` returns `[]` in `bfj` vs `[null]` in `piffero-plus`).
- Verified in Jasmine parity suite: [`bfjParitySpec.ts`](../../spec/piffero/bfjParitySpec.ts).
