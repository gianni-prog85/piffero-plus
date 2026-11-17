# PIFFERO-PLUS  [![NPM version](https://img.shields.io/npm/v/piffero-plus.svg)](https://www.npmjs.com/package/piffero-plus)

The ultimate streaming JSONPath parser for Node.js.

`piffero-plus` is an open-source SAX-like parser (evolved from `piffero`) that operates directly on Node.js `Readable` streams to extract parts of huge JSON files without loading the entire document into memory.

It processes JSON documents larger than available RAM and returns matched values as a valid JSON array stream, string, or Promise—with automatic early stream termination on deterministic queries, full backpressure support, zero runtime dependencies, and full [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) compliance.

```
  ______________________________ .  ♪
=(____|_o_o_o_o_|_o_o_o_o_|*____| |   ♫
                                 '
```

## Table of Contents

- [Why `piffero-plus`?](#why-piffero-plus)
- [Supported JSONPath & RFC 9535 Capabilities](#supported-jsonpath--rfc-9535-capabilities)
- [Installation](#installation)
- [API Overview](#api-overview)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [How It Works](#how-it-works)
- [Development & Benchmarking](#development--benchmarking)
- [Performance](#performance)
- [Full Documentation & Reports](#full-documentation--reports)
- [Other Tools & Credits](#other-tools--credits)

---

## Why `piffero-plus`?

- **Zero runtime dependencies**: Self-contained (`dependencies: {}`) with bundled TypeScript declarations (`dist/index.d.ts`).
- **Larger-than-RAM streaming**: Parses Node.js `Readable` streams token-by-token (`CStream` + `StreamingPathEngine`) without loading the full JSON document or allocating JavaScript objects for unmatched branches.
- **Automatic early stream termination**: Destroys and unpipes the upstream stream immediately once deterministic queries (`$.[1].payload`, `$[0:10:2]`, `$[2,0,2,1:3].id`) finish—delivering **~0.45–1.24 ms** extraction on 200 MiB payloads (up to **~1,697x–7,336x** faster than in-memory `jsonpath-plus` and **~12x–21x** faster than Oboe).
- **Backpressure-aware JSON pass-through**: `Piffero.findByPath()` emits a chunked, backpressure-aware Node.js `Readable` stream outputting a valid JSON array (`[...]`) ready to `.pipe(res)` with zero `JSON.parse`/`JSON.stringify` round-trips, `skipDecode` on skipped subtrees, and `PrunedJsBuilder` field pruning for filters.
- **Full RFC 9535 JSONPath compliance on streams**:
  - Recursive descent (`..`), wildcards (`*`), full RFC 9535 slices (negative bounds/steps & `step=0`), and **heterogeneous bracket unions preserving selector order and duplicates** (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['b', 'a', 'b']`).
  - Parenless `?` and Goessner `?()` filters, singleton `NOTHING` & structural equality semantics (`false`/`0`/`""`/`null` existence, non-coercing `==`, type-safe `<`/`>`), full sub-queries (`@..price`, `@.tags[*]`), and root `$` references (even when the root property appears *after* the filtered array in the stream).
  - All 5 RFC 9535 standard functions: `length()`, `count()`, `match()`, `search()`, and `value()` (with RFC 9485 I-Regexp validation & caching).
  - `\uXXXX`/UTF-16 surrogate escapes, I-JSON safe integer bounds, `member-name-shorthand` validation, and script expressions (`(@.length-1)`).
- **Flexible APIs & fail-fast errors**: Choose `findByPath` (Stream), `findAsString` (callback), or `findAsPromise` (`async`/`await`), with synchronous syntax validation (`PifferoJsonPathError`) and clean malformed-JSON errors (`PifferoError`).
- **Proven speed**: Ranks #1 across early-file lookups, mid/end-of-file lookups, slices, heterogeneous unions, selective nested wildcards, recursive descent, and RFC 9535 filters over 200 MiB payloads against 7 libraries (see [Performance](#performance)).

---

## Supported JSONPath & RFC 9535 Capabilities

`piffero-plus` supports both [Stefan Goessner's JSONPath](http://goessner.net/articles/JsonPath/) and the [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) standard on streaming JSON:

| Operator / Construct | Description | Status |
|---|---|---|
| `$` | Root object/element (also supported inside filters & scripts) | ✅ |
| `@` | Current object/element (objects, nested properties, primitives, `NOTHING`) | ✅ |
| `.name` | Child member shorthand (with RFC 9535 `member-name-shorthand` validation) | ✅ |
| `..` | Recursive descendant operator (depth-first pre-order) | ✅ |
| `*` / `[*]` | Wildcard matching all object properties or array elements | ✅ |
| `[i]` / `['key']` | Subscript operator (I-JSON safe integers, negative indices, `\uXXXX`/surrogates) | ✅ |
| `[,]` | Heterogeneous union operator preserving exact selector order and duplicates | ✅ |
| `[start:end:step]` | RFC 9535 array slice operator (negative bounds/step, `step = 0` empty result) | ✅ |
| `?` / `?()` | RFC 9535 filters (`===`, `!==`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `\|\|`, `!`, existence, structural equality, sub-queries) | ✅ |
| `length` `count` `match` `search` `value` | RFC 9535 standard filter functions with compile-time type checking & I-Regexp (RFC 9485) | ✅ |
| `()` | Script expressions (static arithmetic, `@.length - k`, and `$` index expressions) | ✅ |

### Quick Feature Examples

| Feature | Examples | Notes |
|---|---|---|
| **Child & Escaped Keys** | `$.firstName`, `$['first-name']`, `$['\uD83D\uDE00']` | `\uXXXX` and UTF-16 surrogate pair decoding; fast-path when unescaped |
| **Heterogeneous Unions** | `$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]`, `$['name', ?@.active]` | Preserves exact selector order and duplicates; O(1) fast-path on sorted distinct indexes |
| **Array Indexing & Slices** | `$.employees[1]`, `$[0:10:2]`, `$[10:0:-1]`, `$[-2:]` | O(1) streaming for forward slices; O(*k*) ring buffer for reverse/tail slices |
| **Wildcard & Descent** | `$.*`, `$.employees[*].name`, `$..number`, `$.employees..type` | Depth-first pre-order traversal across arbitrary nesting |
| **RFC 9535 Filters** | `$[?@.v]`, `$[?@.a == @.b]`, `$.items[?@.price < $.maxPrice]` | Falsy-safe existence (`false`/`0`/`""`/`null`), non-coercing `==`, `NOTHING`-safe `<`/`>`, `PrunedJsBuilder` |
| **RFC 9535 Functions** | `$[?length(@.tags) >= 2]`, `$[?match(@.name, "[A-Z][a-z]+")]`, `$[?count(@.scores[*]) > 1]` | Supports `length()`, `count()`, `value()`, `match()`, `search()` |
| **Script Expressions** | `$.employees[(1+1)]`, `$.employees[(@.length-1)].name`, `$.items[($.idx)]` | Static arithmetic and O(*k*) tail-buffered `@.length - k` |

> **Output format:** `piffero-plus` **always** produces a valid JSON array (`[...]`)—whether consumed as a stream, string callback, or Promise. Empty matches return `"[]"`, single matches return `"[value]"`, and JSON `null` values are preserved. See the [JSONPath Syntax & RFC 9535 Guide](./docs/jsonpath-guide.md) for complete semantics.

---

## Installation

```bash
npm install piffero-plus
```

---

## API Overview

`piffero-plus` exports the `Piffero` class with three static methods (full details in [API Reference](./docs/api-reference.md)):

| Method | Signature | Returns | Best For |
|---|---|---|---|
| **`Piffero.findByPath`** | `(stream: Readable, jsonPath?: string)` | `Stream` (`Readable` at runtime) | Large result sets, `.pipe(res)` HTTP streaming, file-to-file pipelines |
| **`Piffero.findAsString`** | `(callback: (result, err?) => void, stream: Readable, jsonPath?: string)` | `void` | Callback-based codebases & fastest small-output extraction |
| **`Piffero.findAsPromise`** | `(stream: Readable, jsonPath?: string)` | `Promise<string>` | `async`/`await` workflows & point/slice lookups |

- `jsonPath` defaults to `"$"` (matches the root JSON value, returning `"[<root>]"`).
- `findAsString` invokes `callback(result, err)` with `err === null` on success.
- `findAsPromise` resolves to a JSON-encoded array string (`"[...]"`): use `JSON.parse(result)` to obtain JS objects/arrays.

---

## Error Handling

- **Invalid JSONPath syntax (`PifferoJsonPathError`)**: `Piffero.findByPath`, `findAsString`, and `findAsPromise` validate the query **synchronously** before touching the stream and throw `PifferoJsonPathError` on invalid paths (missing leading `$`, unclosed brackets/quotes, invalid I-JSON integers, unknown functions, etc.).
- **Malformed JSON input (`PifferoError`)**: Wrapped in `PifferoError` and delivered asynchronously via:
  - the `'error'` event on the returned stream (`findByPath`),
  - the second `err` argument of the callback (`findAsString`),
  - Promise rejection (`findAsPromise`).

> Note: The top-level package exports `{ Piffero }`. For `instanceof` checks, you can import `PifferoError` and `PifferoJsonPathError` from `piffero-plus/dist/src/handler/mastehandler`, or check `err.constructor.name`. Always attach an `'error'` listener to your source `Readable` stream when using `findByPath` (see [API Reference](./docs/api-reference.md#error-types--handling)).

---

## Examples

All examples below use `employees.json`:

<details>
<summary>Sample <code>employees.json</code></summary>

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

</details>

### 1. Stream extraction with `findByPath()`

```js
const { Piffero } = require('piffero-plus');
const fs = require('fs');

const inputStream = fs.createReadStream('./employees.json');
const resultStream = Piffero.findByPath(inputStream, '$.employees[1]');

let resultString = '';
inputStream.on('error', err => console.error('Input error:', err));
resultStream.on('data', chunk => { resultString += chunk.toString(); });
resultStream.on('end', () => console.log(resultString));
resultStream.on('error', err => console.error('Parse error:', err));
```

Output:

```json
[{"name":"Joe","surname":"Black","active":false,"address":{"city":"Milan"},"phoneNumbers":[]}]
```

### 2. Callback & `async`/`await` with `findAsString()` and `findAsPromise()`

```js
const { Piffero } = require('piffero-plus');
const fs = require('fs');

// Callback style
Piffero.findAsString(
  (result, err) => {
    if (err) return console.error(err);
    console.log(result);
  },
  fs.createReadStream('./employees.json'),
  '$.employees[0].phoneNumbers[1]'
);

// Promise / async-await style
async function run() {
  const result = await Piffero.findAsPromise(
    fs.createReadStream('./employees.json'),
    '$.employees[*].name'
  );
  console.log(JSON.parse(result)); // ['John', 'Joe']
}
run();
```

### 3. Advanced JSONPath & RFC 9535 Queries

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

// RFC 9535 standard functions (length, count, match, search, value)
await Piffero.findAsPromise(
  fs.createReadStream('./employees.json'),
  '$.employees[?length(@.phoneNumbers) > 0 && match(@.name, "J[a-z]+")].name'
);
// => ["John"]

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

### 4. Express.js Streaming Endpoint (TypeScript)

```ts
import * as fs from "fs";
import * as express from "express";
import { Piffero } from "piffero-plus";

const app: express.Application = express();

app.get("/api/:jsonPath", (req, res) => {
  const jsonPath: string = req.params.jsonPath;
  const inputStream: fs.ReadStream = fs.createReadStream("./employees.json");

  let resultStream;
  try {
    resultStream = Piffero.findByPath(inputStream, jsonPath);
  } catch (err: any) {
    inputStream.destroy();
    res.status(400).json({ error: err.message });
    return;
  }

  inputStream.on("error", (err) => resultStream.destroy(err));
  resultStream.on("error", (err: any) => {
    if (!res.headersSent) res.status(422).json({ error: err.message });
    else res.destroy(err);
  });

  res.setHeader("Content-Type", "application/json");
  resultStream.pipe(res);
});

app.listen(3000, () => {
  console.log("Open: http://localhost:3000/api/$.employees[0].phoneNumbers[1]");
});
```

---

## How It Works

```text
Readable Stream ──▶ CStream (SAX tokenizer + skipDecode)
                       │
                       ▼
                  MasterHandler
                   ├── SingleStepHandler   (fast-path for simple linear paths)
                   └── StreamingPathEngine (wildcards, .., slices, unions, filters, scripts)
                       │
                       ▼
                  Chunked JSON Output ([...]) with backpressure & early stream destroy
```

Key internal optimizations:
- **`skipDecode`**: Skips UTF-8 string decoding inside unmatched JSON subtrees.
- **`PrunedJsBuilder` & `rootProjection`**: Materializes only the properties actually referenced by filters, downstream steps, and root (`$`) sub-queries.
- **`rootMaxIndex` early exit**: Immediately stops reading the upstream stream once deterministic indices/slices/unions are satisfied.
- **Ring-buffered tail queries**: Evaluates `$[-k:]` and `@.length - k` in O(*k*) memory without collecting the full array.

Read the deep dive in [Internal Architecture & Performance Engineering](./docs/architecture.md).

---

## Development & Benchmarking

All benchmark suites automatically generate and cache a **200 MiB** (`200.01 MiB` / `209.72 MB`, `62,683` elements) JSON dataset in `os.tmpdir()` from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json) on first run:

```bash
npm install                      # Install devDependencies (required for build/test/benchmarks)
npm run build                    # Compile TypeScript to ./dist
npm test                         # Run Jasmine test suite
npm run lint                     # Run TSLint
npm run benchmark                # Benchmark.Suite on 200 MiB JSON (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # 11-scenario 200 MiB comparison (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:streaming      # 7-scenario 200 MiB comparison (piffero-plus vs @sapientpro/json-stream vs stream-json vs json-web-streams)
npm run benchmark:bfj            # 5-scenario 200 MiB comparison (piffero-plus vs bfj)
npm run benchmark:200mb          # 15-scenario 200 MiB scale comparison across all 7 libraries
npm run benchmark:filters        # ConditionEval RFC 9535 filter microbenchmark (200k ops/case)
```

---

## Performance

Benchmarks run on the **200 MiB** GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` records generated from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json)) against 7 libraries (`@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `Oboe`, `bfj`, and in-memory `jsonpath-plus`).

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
| **RFC 9535 filters (`?[...]`, `==`, `NOTHING`-safe `>`)** | **1460.66–1610.40 ms** | **Only streaming library with full RFC 9535 filters**: **~1.28x** faster than `jsonpath-plus` on `$[?(@.type == "IssuesEvent")].id` (`1460.66 ms` vs `1866.99 ms`), **~2.8x** faster than `Oboe` on `$[?@.payload.issue]`, and safely handles missing paths where `jsonpath-plus` throws `TypeError` |

---

## Full Documentation & Reports

- **Guides & References**
  - [API Reference (`findByPath`, `findAsString`, `findAsPromise`, Errors, Recipes)](./docs/api-reference.md)
  - [JSONPath Syntax & RFC 9535 Semantics Guide (Selectors, `NOTHING`, Functions, I-Regexp)](./docs/jsonpath-guide.md)
  - [Internal Architecture & Performance Engineering](./docs/architecture.md)
  - [Why Choose `piffero-plus`: Architecture, RFC 9535 & Performance Advantages](./docs/advantages.md)
- **Benchmark Reports**
  - [200 MiB Scale Comparison (15 Scenarios across 7 Libraries)](./docs/benchmarks/scale-200mb.md)
  - [Full 8-Library Feature & JSONPath Compatibility Matrix](./docs/benchmarks/feature-matrix.md)
  - [Streaming Parsers Comparison (`@sapientpro/json-stream`, `stream-json`, `json-web-streams`)](./docs/benchmarks/streaming-parsers.md)
  - [Extended 11-Scenario Comparison (`Oboe`, `@streamparser/json`, `jsonpath-plus`)](./docs/benchmarks/general-comparison.md)
  - [`piffero-plus` vs `bfj` Comparison](./docs/benchmarks/bfj-comparison.md)

---

## Other Tools & Credits

- `piffero-plus` is built on [Clarinet](https://github.com/dscape/clarinet).
- Compared libraries: [@sapientpro/json-stream](https://www.npmjs.com/package/@sapientpro/json-stream) · [stream-json](https://www.npmjs.com/package/stream-json) · [json-web-streams](https://www.npmjs.com/package/json-web-streams) · [@streamparser/json](https://www.npmjs.com/package/@streamparser/json) · [Oboe](https://github.com/jimhigson/oboe.js) · [bfj](https://www.npmjs.com/package/bfj) · [jsonpath-plus](https://www.npmjs.com/package/jsonpath-plus)
- License: [MIT](./LICENSE)

Enjoy `piffero-plus`!
