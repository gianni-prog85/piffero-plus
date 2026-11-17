# PIFFERO-PLUS  [![NPM version](https://img.shields.io/npm/v/piffero-plus.svg)](https://www.npmjs.com/package/piffero-plus)
The ultimate streaming JSONPath parser for Node.js

`piffero-plus` is an open source SAX-like parser (evolved from `piffero`) that operates directly on Node.js streams to extract parts of large JSON files without loading the entire document into memory.

`piffero-plus` can process JSON files larger than available RAM and return the matched values as a valid JSON array stream, string, or Promise—with early stream termination on deterministic queries and full Node.js stream backpressure support.

```
  ______________________________ .  ♪
=(____|_o_o_o_o_|_o_o_o_o_|*____| |   ♫
                                 '
```

## Why `piffero-plus`?

- **Zero runtime dependencies**: Lightweight and self-contained (`dependencies: {}`), with bundled TypeScript declarations (`.d.ts`).
- **Larger-than-RAM streaming**: Parses Node.js `Readable` streams token-by-token (`CStream` + `StreamingPathEngine`) without loading the full JSON document or allocating JavaScript objects for unmatched branches.
- **Automatic early stream termination**: Destroys the upstream stream immediately once deterministic queries (`$.[1].payload`, `$[0:10:2]`, `$[2,0,2,1:3].id`) complete—delivering **~0.45–1.24 ms** extraction on 200 MiB payloads (up to **~1,697x–7,336x** faster than in-memory `jsonpath-plus` and **~12x–24x** faster than Oboe).
- **Backpressure-aware JSON pass-through + `skipDecode` & `PrunedJsBuilder`**: `Piffero.findByPath()` emits a chunked, backpressure-aware Node.js `Readable` stream containing a valid JSON array (`[...]`) ready to `.pipe(res)` with zero stringify round-trips, bypasses UTF-8 decoding on skipped subtrees (`skipDecode`), and prunes unused properties when evaluating filters (`PrunedJsBuilder`).
- **Full RFC 9535 JSONPath compliance on streams**: Supports recursive descent (`..`), wildcards (`*`), full RFC 9535 slices (negative bounds/steps & `step=0`), **heterogeneous bracket unions preserving selector order and duplicates** (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['b', 'a', 'b']`), both parenthesized `?()` and parenless `?` filters, singleton `NOTHING` & structural equality semantics (`false`/`0`/`""`/`null` existence, non-coercing `==`, type-safe `<`/`>`), `\uXXXX`/surrogate escapes, I-JSON bounds, and script expressions (`(@.length-1)`).
- **Flexible APIs & fail-fast errors**: Use `findByPath` (Stream), `findAsString` (callback), or `findAsPromise` (`async`/`await`) with clear separation between synchronous syntax validation (`PifferoJsonPathError`) and malformed JSON stream errors (`PifferoError`).
- **Proven speed**: Ranks #1 across early-file lookups, mid/end-of-file lookups, slices, heterogeneous unions, selective nested wildcards, recursive descent, and RFC 9535 filters over 200 MiB payloads against 7 libraries (see [PERFORMANCE](#performance) and [Full Advantages Guide](./docs/advantages.md)).

# Description

`piffero-plus` supports both [Stefan Goessner's JSONPath](http://goessner.net/articles/JsonPath/) and the [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) standard semantics on streaming JSON:

JSONPath           | Description                                                                   | Implemented
-------------------|-------------------------------------------------------------------------------|------------
`$`                | The root object/element                                                       | ✅
`@`                | The current object/element (objects, nested properties, primitives, `NOTHING`) | ✅
`.`                | Child member operator (with RFC 9535 `member-name-shorthand` validation)       | ✅
`..`               | Recursive descendant operator (depth-first pre-order)                          | ✅
`*`                | Wildcard matching all objects/elements regardless of their names              | ✅
`[]`               | Subscript operator (I-JSON indexes, `\uXXXX`/surrogate quoted keys, negatives) | ✅
`[,]`              | Heterogeneous union operator preserving exact selector order and duplicates    | ✅
`[start:end:step]` | RFC 9535 array slice operator (negative indices/step, `step = 0` empty result) | ✅
`?()` / `?`        | RFC 9535 filter expressions (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `\|\|`, `!`, existence, structural equality) | ✅
`()`               | Script expressions (static arithmetic and `@.length` expressions)              | ✅

## Supported JSONPath Capabilities

| Feature | Examples | Notes |
|---|---|---|
| **Child & Escaped Bracket Keys** | `$.firstName`, `$['firstName']`, `$['\uD83D\uDE00']` | Decode of `\uXXXX` and UTF-16 surrogate pairs; fast-path when no escapes exist |
| **Heterogeneous & Ordered Unions (`[,]`)** | `$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]`, `$['name', ?@.active]` | Preserves exact selector order and duplicates; zero-overhead fast-path on sorted distinct indexes |
| **RFC 9535 Array Indexing & Slices** | `$.employees[1]`, `$[0:10:2]`, `$[10:0:-1]`, `$[-2:]` | O(1) evaluation on forward queries + O(*k*) ring buffer for reverse/tail slices |
| **Wildcard (`*`)** | `$.*`, `$.employees[*].name`, `$.employees[*].phoneNumbers[*].number` | Matches all properties of objects or all elements of arrays |
| **Recursive Descent (`..`)** | `$..number`, `$.employees..type`, `$..['b', 'a', 'b']` | Depth-first pre-order traversal across arbitrary nesting |
| **RFC 9535 Filters (`?` / `?()`)** | `$[?@.v]`, `$[?@.a == @.b]`, `$[?@.price >= 10 && @.inStock]`, `$.scores[?(@ > 10)]` | Parenless `?[...]` & `?([...])`, falsy-safe existence, strict `==` + deep structural equality, `NOTHING`-safe comparisons, `PrunedJsBuilder` field pruning |
| **Script Expressions (`()`)** | `$.employees[(1+1)]`, `$.employees[(@.length-1)].name` | Static index calculation and O(*k*) tail-buffered `@.length - k` evaluation |

> **Output format:** `piffero-plus` always produces a valid JSON array (`[...]`) whether consumed as a stream, callback string, or Promise—preserving document order for wildcards/filters/slices (reversed on negative-step slices) and exact **selector order (including duplicates)** inside union brackets `[,]` per RFC 9535.

# Get Started

*Step 1*: install `piffero-plus`

```bash
npm i piffero-plus
```

*Step 2*: use `piffero-plus`

Call one of the three static methods on `Piffero` (exported by `piffero-plus`):

- `Piffero.findByPath(inputStream: Readable, jsonPath?: string): Stream` — returns a `Readable` stream emitting the matched JSON array (backpressure-aware, chunked output).
- `Piffero.findAsString(callback: (result: any, err?: any) => void, inputStream: Readable, jsonPath?: string): void` — invokes `callback(result, err)` once matching completes.
- `Piffero.findAsPromise(inputStream: Readable, jsonPath?: string): Promise<string>` — resolves with the JSON string or rejects on error.

## Error Handling

- **Invalid JSONPath syntax**: `Piffero.findByPath`, `findAsString`, and `findAsPromise` synchronously throw `PifferoJsonPathError` (e.g., paths not starting with `$`, unmatched brackets, or malformed filter/script expressions).
- **Malformed JSON input**: wrapped in `PifferoError` and propagated via:
  - the `'error'` event on the returned stream (`findByPath`),
  - the second `err` argument of the callback (`findAsString`),
  - Promise rejection (`findAsPromise`).

## Examples

Below are examples based on `employees.json`:

#### employees.json
```json
{
   "employees":[
      {
         "name":"John",
         "surname":"Doe",
         "active":true,
         "address":{ "city":"Rome" },
         "phoneNumbers":[
            {
               "type":"iPhone",
               "number":"0123-4567-8888",
               "test":false
            },
            {
               "type":"home",
               "number":"0123-4567-8910",
               "test":true
            }
         ]
      },
      {
         "name":"Joe",
         "surname":"Black",
         "active":false,
         "address":{ "city":"Milan" },
         "phoneNumbers":[]
      }
   ]
}
```

### Example: Extract with `findByPath()`

Extract the second employee (`"Joe Black"`) as a stream:

```js
const { Piffero } = require('piffero-plus');
const fs = require('fs');

const inputStream = fs.createReadStream('./employees.json');
const resultStream = Piffero.findByPath(inputStream, '$.employees[1]');

let resultString = '';
resultStream.on('data', chunk => { resultString += chunk.toString(); });
resultStream.on('end', () => console.log(resultString));
resultStream.on('error', err => console.error(err));
```
#### Console result
```json
[{"name":"Joe","surname":"Black","active":false,"address":{"city":"Milan"},"phoneNumbers":[]}]
```

### Example: Extract with `findAsString()` and `findAsPromise()`

```js
const { Piffero } = require('piffero-plus');
const fs = require('fs');

// Callback style
Piffero.findAsString(
  (result, err) => console.log(result),
  fs.createReadStream('./employees.json'),
  '$.employees[0].phoneNumbers[1]'
);

// Promise / async-await style
async function run() {
  const result = await Piffero.findAsPromise(
    fs.createReadStream('./employees.json'),
    '$.employees[*].name'
  );
  console.log(result); // ["John","Joe"]
}
```

### Example: Advanced JSONPath Queries (`..`, `*`, `?()`, `@`, `()`)

```js
// Wildcard: extract all phone numbers across all employees
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$.employees[*].phoneNumbers[*].number');
// => ["0123-4567-8888","0123-4567-8910"]

// Recursive descent: find every "number" property at any nesting depth
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$..number');
// => ["0123-4567-8888","0123-4567-8910"]

// Compound filter with nested @ property access
await Piffero.findAsPromise(
  fs.createReadStream('./employees.json'),
  '$.employees[?(@.active === true && @.address.city === "Rome")].surname'
);
// => ["Doe"]

// RFC 9535 parenless filter (existence check & strict == without coercion)
await Piffero.findAsPromise(
  fs.createReadStream('./employees.json'),
  '$.employees[?@.address.city == "Milan"].name'
);
// => ["Joe"]

// Ordered heterogeneous union (preserves selector order & duplicates)
await Piffero.findAsPromise(
  fs.createReadStream('./employees.json'),
  "$.employees[1, 0, 1]['surname', 'name']"
);
// => ["Black","Joe","Doe","John","Black","Joe"]

// Script expression with @.length: get the last employee's name
await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$.employees[(@.length-1)].name');
// => ["Joe"]
```

### Example: Express.js streaming endpoint with TypeScript

```ts
import * as fs from "fs";
import * as express from "express";
import { Piffero } from "piffero-plus";

const app: express.Application = express();

app.get("/api/:jsonPath", (req, res) => {
  const jsonPath: string = req.params.jsonPath;
  const inputStream: fs.ReadStream = fs.createReadStream('./employees.json');
  const resultStream = Piffero.findByPath(inputStream, jsonPath);

  res.setHeader("Content-Type", "application/json");
  resultStream.pipe(res);
});

app.listen(3000, () => {
  console.log("Open your browser at: http://localhost:3000/api/$.employees[0].phoneNumbers[1]");
});
```

## Development & Benchmarking

All benchmark suites automatically generate and cache a **200 MiB** (`200.01 MiB` / `209.72 MB`, `62,683` elements) JSON dataset in `os.tmpdir()` from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json) on first run:

```bash
npm run build                    # Compile TypeScript to ./dist
npm test                         # Run Jasmine test suite (187 specs)
npm run benchmark                # Benchmark.Suite on 200 MiB JSON (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # 9-scenario 200 MiB comparison (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:streaming      # 7-scenario 200 MiB comparison (piffero-plus vs @sapientpro/json-stream vs stream-json vs json-web-streams)
npm run benchmark:bfj            # 5-scenario 200 MiB comparison (piffero-plus vs bfj)
npm run benchmark:200mb          # 15-scenario 200 MiB scale comparison across all 7 libraries
npm run benchmark:filters        # ConditionEval RFC 9535 filter microbenchmark (200k ops/case)
```

## PERFORMANCE

Benchmarks run on the **200 MiB** GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` records generated from `spec/jsonFiles/large-file.json`) against 7 libraries (`@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `Oboe`, `bfj`, and in-memory `jsonpath-plus`).

### Summary (200 MiB JSON)

| Workload | Best `piffero-plus` | Key Comparison |
|---|---|---|
| **Early-exit index (`$.[1].payload`)** | **0.45 ms** (`string`) | **#1 overall**: ahead of `@sapientpro/json-stream` (`0.73 ms`), `@streamparser/json` (`1.09 ms`), **~7.9x** vs `bfj` (`4.36 ms`), **~10x** vs `stream-json` (`4.48 ms`), **~21x** vs `Oboe` (`9.48 ms`), **~7,336x** vs `jsonpath-plus` (`3301.31 ms`); `json-web-streams` unsupported |
| **Mid / End-of-file lookup (`$.[31341]` / `$.[56754]`)** | **601.17 ms** / **1052.55 ms** (`string`) | **#1 overall**: ahead of `@sapientpro/json-stream` (`626.28` / `1121.61 ms`), `jsonpath-plus` (`2061.89` / `1765.17 ms`), `@streamparser/json` (`1711.00` / `3171.93 ms`), `stream-json` (`2214.46` / `4103.15 ms`), `Oboe` (`3230.70` / `4118.41 ms`), and **~52.8x** vs `bfj` |
| **Slices (`$[0:10:2]`, `$[10:0:-1]`)** | **1.24 ms** / **1054.89 ms** | **#1 overall & only streaming parser** with RFC 9535 slices: **~1,697x** faster on `$[0:10:2]` and **~1.7x** faster on reverse slices than `jsonpath-plus` (`2104.39` / `1840.44 ms`) |
| **Heterogeneous union (`$[2,0,2,1:3].id`)** | **0.48 ms** (`string`) | **#1 overall & only streaming parser** supporting mixed reordered unions + duplicates (**~3,088x** faster than `jsonpath-plus` at `1482.23 ms`) |
| **Key union (`$[*]['type','id']`, 125k matches)** | **1374.04 ms** (`string`) | **Only streaming parser preserving RFC 9535 selector order** (`type` before `id`); **~1.57x** faster than `jsonpath-plus` (`2153.09 ms`), **~2.59x** vs `@streamparser/json` (`3562.81 ms`), **~4.17x** vs `stream-json` (`5724.10 ms`) |
| **Selective nested wildcards (`$[*].payload.commits[*].author.email`)** | **1611.00 ms** (`stream`) | **#1 overall**: ahead of `json-web-streams` (`1669.64 ms`), `jsonpath-plus` (`1735.45 ms`), `@sapientpro/json-stream` (`1911.17 ms`), `@streamparser/json` (`3756.11 ms`), `Oboe` (`4499.91 ms`), and `stream-json` (`5619.68 ms`) |
| **Recursive descent (`$..user.login`)** | **2602.03 ms** (`string`) | **Fastest streaming parser**: faster than `@sapientpro/json-stream` (`3138.20 ms`), `Oboe` (`4518.88 ms`), `stream-json` (`5488.51 ms`), and **~22.8x** vs `bfj` (`$..login`); `@streamparser/json` & `json-web-streams` unsupported |
| **RFC 9535 filters (`?[...]`, `==`, `NOTHING`-safe `>`)** | **1460.66–1610.40 ms** | **Only streaming library with full RFC 9535 filters**: **~1.28x** faster than `jsonpath-plus` on `$[?(@.type == "IssuesEvent")].id` (`1460.66 ms` vs `1866.99 ms`), **~2.8x** faster than `Oboe` on `?[?@.payload.issue]`, and safely handles missing paths where `jsonpath-plus` throws `TypeError` |

### Full Reports & Documentation

- [Why Choose `piffero-plus`: Architecture, RFC 9535 & Performance Advantages](./docs/advantages.md)
- [200 MiB Scale Comparison (15 Scenarios across 7 Libraries)](./docs/benchmarks/scale-200mb.md)
- [Full 8-Library Feature & JSONPath Compatibility Matrix](./docs/benchmarks/feature-matrix.md)
- [Streaming Parsers Comparison (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)](./docs/benchmarks/streaming-parsers.md)
- [Extended 9-Scenario Comparison (`Oboe`, `@streamparser/json`, `jsonpath-plus`)](./docs/benchmarks/general-comparison.md)
- [`piffero-plus` vs `bfj` Comparison](./docs/benchmarks/bfj-comparison.md)

## Other tools
* `piffero-plus` is built on [Clarinet](https://github.com/dscape/clarinet)
* Compared libraries: [@sapientpro/json-stream](https://www.npmjs.com/package/@sapientpro/json-stream) · [stream-json](https://www.npmjs.com/package/stream-json) · [json-web-streams](https://www.npmjs.com/package/json-web-streams) · [@streamparser/json](https://www.npmjs.com/package/@streamparser/json) · [Oboe](https://github.com/jimhigson/oboe.js) · [bfj](https://www.npmjs.com/package/bfj) · [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus)
* You can also try [JSONPath Online Evaluator](https://jsonpath.com/)

enjoy `piffero-plus`!!

