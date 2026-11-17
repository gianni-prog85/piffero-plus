# `piffero-plus` vs Modern Streaming Parsers (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)

Full benchmark and parity comparison executed on the 200 MiB GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` elements generated in `os.tmpdir()` from [large-file.json](../../spec/jsonFiles/large-file.json)) using [`compare-streaming.js`](../../benchmarking/compare-streaming.js).

```bash
npm run benchmark:streaming
```

## Libraries Tested

| Library | Version | Architecture | JSONPath / Selector Model |
|---|---|---|---|
| **`piffero-plus`** | `1.0.0` (base `1.1.13`) | Node.js `Readable` / string callback / Promise (Clarinet SAX) | Full JSONPath (`..`, `*`, `?()`, slices, unions, negative indexes, `()`) + auto early exit |
| **`@sapientpro/json-stream`** | `3.0.0` | Incremental TypeScript scanner (`onValue` callbacks) | Subset (`$.a`, `$[i]`, `*`, `..`); rejects `?()`, slices, unions, negative indexes |
| **`stream-json`** | `3.9.0` | Token pipeline (`parser` → `pick` → `streamValues` / `streamArray`) | String / RegExp / function path filters (no native JSONPath parser) |
| **`json-web-streams`** | `1.2.0` | Web `TransformStream` (`TextDecoderStream` → `JSONParseStream`) | Strict subset (`.key`, `['key']`, `.*`, `[*]`); rejects `[i]`, `..`, `?()`, slices, unions |

## Benchmark Results (200 MiB JSON)

> Notes:
> - `piffero-plus` outputs serialized JSON (`[...]`), and the harness runs `JSON.parse()` to verify exact match counts; the other three parsers emit assembled JS objects directly.
> - For early-exit scenarios (`1` and `2`), `piffero-plus` terminates upstream automatically while `@sapientpro/json-stream` (`s.destroy()`) and `stream-json` (`once: true` + `input.destroy()`) use explicit manual teardown.

### 1. Early file (`$.[1].payload`, 1 match)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (string)** | **0.52** | **0.44** | **1922.83** | 1 |
| `@sapientpro/json-stream` | 1.02 | 1.00 | 977.96 | 1 |
| `piffero-plus` (stream) | 1.82 | 1.68 | 548.29 | 1 |
| `stream-json` | 5.18 | 5.41 | 193.05 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 2. Mid file (`$.[31341].payload`, 1 match)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (string)** | **626.82** | **627.34** | **1.60** | 1 |
| `piffero-plus` (stream) | 648.96 | 677.59 | 1.54 | 1 |
| `@sapientpro/json-stream` | 653.92 | 667.74 | 1.53 | 1 |
| `stream-json` | 2353.51 | 2365.95 | 0.42 | 1 |
| `json-web-streams` | N/A | N/A | N/A | N/A (numeric index unsupported) |

### 3. Root array elements (`$[*]`, 62,683 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`json-web-streams`** | **1322.19** | **1337.85** | **0.76** | 62,683 |
| `@sapientpro/json-stream` | 2512.46 | 2556.37 | 0.40 | 62,683 |
| `piffero-plus` (string) | 3379.41 | 3410.90 | 0.30 | 62,683 |
| `piffero-plus` (stream) | 3720.35 | 3780.66 | 0.27 | 62,683 |
| `stream-json` | 4780.08 | 4795.81 | 0.21 | 62,683 |

### 4. Wildcard shallow (`$[*].actor.login`, 62,683 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (stream)** | **1331.90** | 1341.15 | **0.75** | 62,683 |
| **`piffero-plus` (string)** | **1332.79** | **1333.66** | **0.75** | 62,683 |
| `@sapientpro/json-stream` | 1490.44 | 1495.72 | 0.67 | 62,683 |
| `json-web-streams` | 1529.75 | 1536.48 | 0.65 | 62,683 |
| `stream-json` | 5504.25 | 5506.90 | 0.18 | 62,683 |

### 5. Nested wildcard (`$[*].payload.commits[*].author.email`, 55,729 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (string)** | **1508.18** | 1520.67 | **0.66** | 55,729 |
| **`piffero-plus` (stream)** | **1513.78** | **1518.82** | **0.66** | 55,729 |
| `@sapientpro/json-stream` | 1766.77 | 1769.93 | 0.57 | 55,729 |
| `json-web-streams` | 1778.87 | 1787.14 | 0.56 | 55,729 |
| `stream-json` | 5397.23 | 5406.45 | 0.19 | 55,729 |

### 6. Recursive descent (`$..user.login`, 23,715 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (string)** | **2452.23** | **2464.29** | **0.41** | 23,715 |
| **`piffero-plus` (stream)** | **2471.85** | **2477.55** | **0.40** | 23,715 |
| `@sapientpro/json-stream` | 3009.94 | 3027.66 | 0.33 | 23,715 |
| `stream-json` | 5362.21 | 5397.38 | 0.19 | 23,715 |
| `json-web-streams` | N/A | N/A | N/A | N/A (`..` unsupported) |

### 7. Existence filter (`$[?(@.payload.issue)].payload.issue.number`, 7,725 matches)

| Parser | Avg (ms) | Median (ms) | Ops/sec | Matches |
|---|---|---|---|---|
| **`piffero-plus` (string)** | **1604.26** | **1620.74** | **0.62** | 7,725 |
| `piffero-plus` (stream) | 1630.32 | 1632.37 | 0.61 | 7,725 |
| `@sapientpro/json-stream` | N/A | N/A | N/A | N/A (filters unsupported) |
| `stream-json` | N/A | N/A | N/A | N/A (no JSONPath filter engine) |
| `json-web-streams` | N/A | N/A | N/A | N/A (filters unsupported) |

## Key Takeaways

- **Fastest in 6 of 7 scenarios on 200 MiB**: `piffero-plus` wins on early-exit (`0.52 ms`), mid-file (`626.82 ms`), shallow wildcards (`1331.90 ms`), nested wildcards (`1508.18 ms`), recursive descent (`2452.23 ms`), and existence filters (`1604.26 ms`)—even while outputting serialized JSON and paying a `JSON.parse()` verification step in the harness.
- **Vs `stream-json`**: `piffero-plus` is **~1.4x–10.0x faster** across every single scenario (`0.52 ms` vs `5.18 ms` on early-exit, `626.82 ms` vs `2353.51 ms` on mid-file, `1331.90 ms` vs `5504.25 ms` on shallow wildcards, `1508.18 ms` vs `5397.23 ms` on nested wildcards, and `2452.23 ms` vs `5362.21 ms` on recursive descent).
- **Vs `@sapientpro/json-stream` & `json-web-streams`**: `piffero-plus` outpaces both on early-exit (`0.52 ms` vs `1.02 ms`), mid-file (`626.82 ms` vs `653.92 ms`), shallow wildcards (`1331.90 ms` vs `1490.44 ms` / `1529.75 ms`), nested wildcards (`1508.18 ms` vs `1766.77 ms` / `1778.87 ms`), and recursive descent (`2452.23 ms` vs `3009.94 ms`). Additionally, **only `piffero-plus`** supports JSONPath filters `?()`, array slices, unions, negative indexes, automatic early termination, and direct JSON pass-through streaming (`[...]`).
- Verified in Jasmine parity suite: [`streamingParsersParitySpec.ts`](../../spec/piffero/streamingParsersParitySpec.ts).
