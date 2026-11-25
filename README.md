# PIFFERO-PLUS  [![NPM version](https://img.shields.io/npm/v/piffero-plus.svg)](https://www.npmjs.com/package/piffero-plus) [![NPM downloads](https://img.shields.io/npm/dm/piffero-plus.svg)](https://www.npmjs.com/package/piffero-plus) [![CI](https://github.com/gianni-prog85/piffero-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/gianni-prog85/piffero-plus/actions/workflows/ci.yml) [![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json) [![TypeScript](https://img.shields.io/badge/types-TypeScript-blue.svg)](./index.ts) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Zero-dependency streaming RFC 9535 JSONPath parser & CLI for large JSON files, Node.js `Readable` streams, Web `ReadableStream`s (`fetch`), `string`/`Buffer`, and in-memory JS objects.

`piffero-plus` is an open-source SAX-like parser (evolved from `piffero`) that operates directly on streams to extract parts of huge JSON files without loading the entire document into memory—while also supporting synchronous in-memory evaluation via `Piffero.query()` and instant command-line usage via `npx piffero-plus`.

It processes JSON documents larger than available RAM and returns matched values, [RFC 9535 §2.7 Normalized Paths](https://www.rfc-editor.org/rfc/rfc9535#section-2.7), or [RFC 6901 JSON Pointers](https://www.rfc-editor.org/rfc/rfc6901) as a valid JSON array stream, string, Promise, or JavaScript array—with automatic early stream termination on deterministic queries, full backpressure support, zero runtime dependencies, and full [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) compliance.

```
  ______________________________ .  ♪
=(____|_o_o_o_o_|_o_o_o_o_|*____| |   ♫
                                 '
```

## Table of Contents

- [Why `piffero-plus`?](#why-piffero-plus)
- [Supported JSONPath & RFC 9535 Capabilities](#supported-jsonpath--rfc-9535-capabilities)
- [Installation & CLI (`npx`)](#installation--cli-npx)
- [1-Line Migration from `jsonpath-plus`](#1-line-migration-from-jsonpath-plus)
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

- **Zero runtime dependencies & Dual ESM/CommonJS**: Self-contained (`dependencies: {}`) with native `import` / `require` support (`exports` map, `"sideEffects": false`) and bundled TypeScript declarations (`dist/index.d.ts`).
- **Larger-than-RAM streaming**: Parses Node.js `Readable` and WHATWG Web `ReadableStream` (`fetch().body`) token-by-token (`CStream` + `StreamingPathEngine`) without loading the full JSON document or allocating JavaScript objects for unmatched branches.
- **Universal input sources (`PifferoInput`)**: Query Node.js `Readable`, Web `ReadableStream`, raw `string`/`Buffer`/`Uint8Array` (via zero-stream `parseSync`), or already-parsed JavaScript objects/arrays with the exact same RFC 9535 semantics.
- **Automatic early stream termination**: Destroys/cancels the upstream Node `Readable` or Web `ReadableStream` immediately once deterministic queries (`$.[1].payload`, `$[0:10:2]`, `$[2,0,2,1:3].id`) finish—delivering **~0.45–1.24 ms** extraction on 200 MiB payloads (up to **~1,697x–7,336x** faster than in-memory `jsonpath-plus` and **~12x–21x** faster than Oboe).
- **Backpressure-aware JSON pass-through**: `Piffero.findByPath()` emits a chunked, backpressure-aware Node.js `Readable` stream outputting a valid JSON array (`[...]`) ready to `.pipe(res)` with zero `JSON.parse`/`JSON.stringify` round-trips, `skipDecode` on skipped subtrees, and `PrunedJsBuilder` field pruning for filters.
- **Full RFC 9535 JSONPath compliance (including §2.7 Normalized Paths)**:
  - Recursive descent (`..`), wildcards (`*`), full RFC 9535 slices (negative bounds/steps & `step=0`), and **heterogeneous bracket unions preserving selector order and duplicates** (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['b', 'a', 'b']`).
  - Parenless `?` and Goessner `?()` filters, singleton `NOTHING` & structural equality semantics (`false`/`0`/`""`/`null` existence, non-coercing `==`, type-safe `<`/`>`), full sub-queries (`@..price`, `@.tags[*]`), and root `$` references (even when the root property appears *after* the filtered array in the stream).
  - All 5 RFC 9535 standard functions: `length()`, `count()`, `match()`, `search()`, and `value()` (with RFC 9485 I-Regexp validation & caching).
  - **Output modes (`resultType`)**: Return matched values (`"value"`, default), canonical RFC 9535 §2.7 Normalized Paths (`"path"`, e.g. `"$['employees'][0]['name']"`), RFC 6901 JSON Pointers (`"pointer"`, e.g. `"/employees/0/name"`), or combined `{ path, pointer, value }` objects (`"all"`).
  - `\uXXXX`/UTF-16 surrogate escapes, I-JSON safe integer bounds, `member-name-shorthand` validation, and script expressions (`(@.length-1)`).
- **Flexible APIs, CLI & fail-fast errors**: Choose `findByPath` (Stream), `findAsString` (callback), `findAsPromise` (`async`/`await`), synchronous `Piffero.query()` (direct `any[]` output, **~3.0x–3.6x faster** than `jsonpath-plus` on in-memory JS objects), or `npx piffero-plus` from the terminal.
- **Proven speed**: Ranks #1 across early-file lookups, mid/end-of-file lookups, slices, heterogeneous unions, selective nested wildcards, recursive descent, RFC 9535 filters, and in-memory evaluation against 7 libraries (see [Performance](#performance)).

---

## Supported JSONPath & RFC 9535 Capabilities

`piffero-plus` supports both [Stefan Goessner's JSONPath](http://goessner.net/articles/JsonPath/) and the [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) standard across streams and in-memory inputs:

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
| `resultType` (`path` / `pointer` / `all`) | RFC 9535 §2.7 Normalized Paths (`$['a'][0]`), RFC 6901 JSON Pointers (`/a/0`), or `{ path, pointer, value }` | ✅ |

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
| **Normalized Paths & Pointers** | `{ resultType: "path" }`, `{ resultType: "pointer" }`, `{ resultType: "all" }` | Lazy `O(depth)` path formatting; skips container value decoding on `"path"` / `"pointer"` |

> **Output format:** `findByPath`, `findAsString`, and `findAsPromise` **always** produce a valid JSON array (`[...]`), while `Piffero.query()` returns the JavaScript array (`any[]`) directly. Empty matches return `"[]"` (or `[]`), single matches return `"[value]"` (or `[value]`), and JSON `null` values are preserved. See the [JSONPath Syntax & RFC 9535 Guide](./docs/jsonpath-guide.md) for complete semantics.

---

## Installation & CLI (`npx`)

```bash
npm install piffero-plus
```

You can also query multi-gigabyte JSON (or `.gz`) files and streams directly from your terminal using `npx`:

```bash
# Extract values from a large JSON file (streams with bounded RAM & early exit)
npx piffero-plus '$.employees[?@.active == true].name' employees.json

# Stream NDJSON / JSON Lines (--ndjson / --jsonl) or raw unquoted strings (-R / --raw, like jq -r)
npx piffero-plus '$[*].id' huge-200mb.json.gz --raw | head -n 5
npx piffero-plus '$[?@.type == "IssuesEvent"]' huge-200mb.json --ndjson

# Output canonical RFC 9535 §2.7 Normalized Paths (--path) or JSON Pointers (--pointer)
npx piffero-plus '$[0:5].id' huge-200mb.json --path --pretty

# Pipe from stdin / curl / gzip (--gzip auto-detected for .gz files)
curl -s https://example.com/events.json.gz | npx piffero-plus '$[?@.type == "IssuesEvent"].id' --gzip --raw
```

---

## 1-Line Migration from `jsonpath-plus`

`piffero-plus` can replace `jsonpath-plus` both for **in-memory JS objects** (~3.0x–3.6x faster) and **streams/files** (bounded RAM, no `JSON.parse()` OOM):

```ts
import * as fs from "fs";
import { Piffero } from "piffero-plus";

// Before (jsonpath-plus, in-memory only):
// const res = JSONPath({ path: "$.employees[?@.active].name", json: data, resultType: "path" });

// After (piffero-plus — in-memory JS object, ~3x faster + full RFC 9535):
const res = Piffero.query(data, "$.employees[?@.active].name", { resultType: "path" });

// After (piffero-plus — streaming a 200+ MiB file or fetch().body with for await...of):
for await (const name of Piffero.iterate<string>(
  fs.createReadStream("./huge.json"),
  "$.employees[?@.active].name"
)) {
  console.log(name);
  // Calling `break` immediately destroys/cancels the upstream stream!
}
```

### Browser, Edge, Cloudflare Workers, Deno & Bun (`piffero-plus/query`)

Need synchronous in-memory JSONPath in a **browser or edge runtime** with zero Node.js built-ins (`stream`, `fs`, `Buffer`) and zero `eval`/`vm`? Import the dedicated browser-safe subpath:

```ts
import { query, Piffero, PifferoJsonPathError } from "piffero-plus/query";

const titles = query(data, "$.store.book[?@.price < 10].title");
const pointers = Piffero.query(data, "$.store.book[-1]", { resultType: "pointer" });
```

### Interactive Playground

An interactive zero-bundler browser playground powered directly by `piffero-plus/query` is included in [`docs/playground/index.html`](./docs/playground/index.html) (ready for GitHub Pages from `docs/`).

---

## API Overview

`piffero-plus` exports the `Piffero` class with five static methods (full details in [API Reference](./docs/api-reference.md)):

| Method | Signature | Returns | Best For |
|---|---|---|---|
| **`Piffero.iterate<T>`** | `(input: PifferoInput, jsonPath?: string, options?: PifferoQueryOptions)` | `AsyncIterableIterator<T>` | Ergonomic `for await...of` streaming with automatic backpressure & early-exit on `break` |
| **`Piffero.findByPath`** | `(input: PifferoInput, jsonPath?: string, options?: PifferoQueryOptions)` | `Stream` (`Readable` at runtime) | Large result sets, `.pipe(res)` HTTP streaming, file-to-file pipelines |
| **`Piffero.findAsString`** | `(callback: (result, err?) => void, input: PifferoInput, jsonPath?: string, options?: PifferoQueryOptions)` | `void` | Callback-based codebases & fastest small-output extraction from streams |
| **`Piffero.findAsPromise`** | `(input: PifferoInput, jsonPath?: string, options?: PifferoQueryOptions)` | `Promise<string>` | `async`/`await` workflows on Node `Readable` or Web `ReadableStream` (`fetch().body`) |
| **`Piffero.query<T>`** | `(input: object \| any[] \| string \| Buffer \| Uint8Array, jsonPath?: string, options?: PifferoQueryOptions)` | `T[]` | Synchronous evaluation on in-memory JS objects/arrays or `string`/`Buffer` payloads |

- **`PifferoInput`**: Accepts a Node.js `Readable` stream, a WHATWG Web `ReadableStream` (`fetch().body`), a raw JSON `string` / `Buffer` / `Uint8Array`, or an in-memory JS object/array.
- **`options.resultType`**: `"value"` (default), `"path"` (RFC 9535 §2.7 Normalized Path), `"pointer"` (RFC 6901 JSON Pointer), or `"all"` (`PifferoAllResult<T>`: `{ path, pointer, value }`).
- `jsonPath` defaults to `"$"` (matches the root JSON value).

---

## Error Handling

- **Invalid JSONPath syntax (`PifferoJsonPathError`)**: `Piffero.iterate`, `findByPath`, `findAsString`, `findAsPromise`, and `query` validate the query **synchronously** and throw `PifferoJsonPathError` on invalid paths (missing leading `$`, unclosed brackets/quotes, invalid I-JSON integers, unknown functions, etc.).
- **Malformed JSON input (`PifferoError`)**: Wrapped in `PifferoError` and delivered via:
  - async rejection inside `for await...of` (`iterate`),
  - the `'error'` event on the returned stream (`findByPath`),
  - the second `err` argument of the callback (`findAsString`),
  - Promise rejection (`findAsPromise`),
  - synchronous throw (`Piffero.query`).

> Tip: `Piffero`, `PifferoError`, `PifferoJsonPathError`, `PifferoInput`, `WebReadableStreamLike`, `PifferoResultType`, `PifferoAllResult`, and `PifferoQueryOptions` are all exported directly from `'piffero-plus'`. Always attach an `'error'` listener to your source `Readable` stream when using `findByPath` (see [API Reference](./docs/api-reference.md#error-types--handling)).

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

### 4. Normalized Paths (RFC 9535 §2.7), JSON Pointers & `Piffero.query()`

```js
const { Piffero } = require('piffero-plus');
const fs = require('fs');

// 1. Canonical RFC 9535 §2.7 Normalized Paths on a stream
const paths = JSON.parse(
  await Piffero.findAsPromise(fs.createReadStream('./employees.json'), '$..number', {
    resultType: 'path',
  })
);
// => [
//   "$['employees'][0]['phoneNumbers'][0]['number']",
//   "$['employees'][0]['phoneNumbers'][1]['number']"
// ]

// 2. RFC 6901 JSON Pointers or combined { path, pointer, value }
const all = Piffero.query(
  fs.readFileSync('./employees.json'),
  '$.employees[?@.active == true].name',
  { resultType: 'all' }
);
// => [{ path: "$['employees'][0]['name']", pointer: "/employees/0/name", value: "John" }]

// 3. Direct synchronous evaluation on in-memory JS objects
const data = JSON.parse(fs.readFileSync('./employees.json', 'utf8'));
const names = Piffero.query(data, '$.employees[*].name');
// => ['John', 'Joe']

// 4. Streaming directly from a WHATWG Web ReadableStream (fetch().body)
const response = await fetch('https://example.com/huge-events.json');
const firstTwoIds = JSON.parse(
  await Piffero.findAsPromise(response.body, '$[0:2].id')
);
// Automatically cancels response.body once the first 2 items are extracted!
```

### 5. Express.js Streaming Endpoint (TypeScript)

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
Node Readable / Web ReadableStream / string / Buffer / JS Object
                       │
                       ├── JS Object/Array ──▶ evaluateInMemory() (direct AST/step traversal)
                       ▼
                 CStream (SAX tokenizer + skipDecode)
                       │
                       ▼
                 MasterHandler
                  ├── SingleStepHandler   (fast-path for simple linear value paths)
                  └── StreamingPathEngine (wildcards, .., slices, unions, filters, scripts, resultType)
                       │
                       ▼
                 Chunked JSON Output ([...]) or JS Array (Piffero.query)
```

Key internal optimizations:
- **`skipDecode`**: Skips UTF-8 string decoding inside unmatched JSON subtrees (and skips container value serialization when `resultType` is `"path"` or `"pointer"`).
- **`PrunedJsBuilder` & `rootProjection`**: Materializes only the properties actually referenced by filters, downstream steps, and root (`$`) sub-queries.
- **`rootMaxIndex` early exit**: Immediately stops reading the upstream Node `Readable` (`destroy()`) or Web `ReadableStream` (`reader.cancel()`) once deterministic indices/slices/unions are satisfied.
- **Lazy `O(depth)` path formatting**: Tracks object keys and array indices on `frameStack` and formats RFC 9535 Normalized Paths (`$['a'][0]`) or JSON Pointers (`/a/0`) only when a match occurs—with zero overhead when `resultType === "value"`.
- **Ring-buffered tail queries**: Evaluates `$[-k:]` and `@.length - k` in O(*k*) memory without collecting the full array.

Read the deep dive in [Internal Architecture & Performance Engineering](./docs/architecture.md).

---

## Development & Benchmarking

All benchmark suites automatically generate and cache a **200 MiB** (`200.01 MiB` / `209.72 MB`, `62,683` elements) JSON dataset in `os.tmpdir()` from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json) on first run:

```bash
npm install                      # Install devDependencies (required for build/test/benchmarks)
npm run build                    # Compile TypeScript to ./dist
npm test                         # Run Jasmine test suite (205 specs)
npm run lint                     # Run TSLint
npm run benchmark                # Benchmark.Suite on 200 MiB JSON (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:compare        # 11-scenario 200 MiB comparison (piffero-plus vs Oboe vs @streamparser/json vs jsonpath-plus)
npm run benchmark:streaming      # 7-scenario 200 MiB comparison (piffero-plus vs @sapientpro/json-stream vs stream-json vs json-web-streams)
npm run benchmark:bfj            # 5-scenario 200 MiB comparison (piffero-plus vs bfj)
npm run benchmark:200mb          # 15-scenario 200 MiB scale comparison across all 7 libraries
npm run benchmark:filters        # ConditionEval RFC 9535 filter microbenchmark (200k ops/case)
npm run benchmark:phase5         # Phase 5 suite: in-memory Piffero.query(), resultType="path", RFC 9535 functions & WebStream
```

---

## Performance

Benchmarks run on the **200 MiB** GitHub events dataset (`200.01 MiB` / `209.72 MB`, `62,683` records generated from [`spec/jsonFiles/large-file.json`](./spec/jsonFiles/large-file.json)) against 7 libraries (`@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `Oboe`, `bfj`, and in-memory `jsonpath-plus`).

### Summary (200 MiB JSON & In-Memory)

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
| **Pure in-memory `Piffero.query(obj)` (~39 MB parsed JSON)** | **3.92–9.18 ms** | **~3.0x–3.6x faster** than `jsonpath-plus` on already-parsed JS objects across wildcards (`7.51 ms` vs `22.35 ms`), nested wildcards (`6.15 ms` vs `20.77 ms`), equality filters (`3.92 ms` vs `14.21 ms`), and `resultType: "path"` (`9.18 ms` vs `27.57 ms`) |

### `piffero-plus` vs `jsonpath-plus`

If you are coming from `jsonpath-plus`, here is how `piffero-plus` compares across both streaming (200 MiB) and in-memory (`Piffero.query`) workloads:

| Dimension | `piffero-plus` | `jsonpath-plus` |
|---|---|---|
| **Memory & input model** | Bounded-RAM streaming (Node `Readable`, Web `ReadableStream` / `fetch`), `string`/`Buffer`, **plus** synchronous in-memory `Piffero.query(obj)` | Requires full `JSON.parse()` of the entire document in V8 heap before querying |
| **Pure in-memory JS object query (`Piffero.query`)** | **7.51 ms** (`$[*].actor.login`), **6.15 ms** (nested `*`), **3.92 ms** (`==` filter), **9.18 ms** (`resultType: "path"`) | **22.35 ms**, **20.77 ms**, **14.21 ms**, **27.57 ms** (**~3.0x–3.6x slower**) |
| **Point lookups, slices & unions (200 MiB)** | **0.45 ms** (`$.[1].payload`), **1.24 ms** (`$[0:10:2]`), **0.48 ms** (`$[2,0,2,1:3].id`), **601.17 ms** (`$.[31341]`), **1052.55 ms** (`$.[56754]`) | **3301.31 ms**, **2104.39 ms**, **1482.23 ms**, **2061.89 ms**, **1765.17 ms** (**~1.7x–7,336x slower**) |
| **Key unions & equality filters (200 MiB)** | **1374.04 ms** (`$[*]['type','id']`), **1460.66 ms** (`$[?(@.type == "IssuesEvent")].id`) | **2153.09 ms** (**~1.57x slower**), **1866.99 ms** (**~1.28x slower**) |
| **Normalized Paths (`resultType: "path"`, 200 MiB)** | **11.92 ms** on `$[0:10:2]` (**~90x faster** via `skipDecode` + early exit); **2963.13 ms** on full `$[*].actor.login` stream | **1073.55 ms** on `$[0:10:2]`; **1506.70 ms** on full `$[*].actor.login` in-RAM |
| **Full-document in-RAM scans (`$[*]`, `$..user.login`)** | **3346.97 ms** (`$[*]`), **2602.03 ms** (`$..user.login`) with bounded memory | **2049.36 ms** (`$[*]`), **1826.14 ms** (`$..user.login`) when the entire JSON fits in RAM |
| **RFC 9535 parenless filters (`$[?@.payload.issue]`)** | ✅ Full support (**1590.25 ms** on 200 MiB) | ❌ Silently returns `[]` |
| **Missing intermediate properties (`@.a.b.c > 1000`)** | ✅ Safe `NOTHING` propagation (**1610.40 ms** on 200 MiB) | ❌ Throws `TypeError` |
| **Existence & `==` semantics** | ✅ Falsy-safe (`false`/`0`/`""`/`null`) + non-coercing `==` (`"1" != 1`) | ❌ JS truthiness & `==` coercion (`"1" == 1`) |
| **Unions with spaces & mixed selectors** | ✅ `$[2, 0, 2]`, `$['name', ?@.active]` preserve order & duplicates | ⚠️ Breaks on spaces (`$[2, 0, 2]`), drops key in key+filter union |
| **Standard functions & `\uXXXX` escapes** | ✅ `length()`, `count()`, `match()`, `search()`, `value()`, `\uXXXX`, I-JSON bounds | ❌ Non-standard / no `\uXXXX` decode in brackets |

---

## Full Documentation & Reports

- **Guides & References**
  - [API Reference (`findByPath`, `findAsString`, `findAsPromise`, `query`, `resultType`, Universal Inputs, Errors)](./docs/api-reference.md)
  - [JSONPath Syntax & RFC 9535 Semantics Guide (Selectors, `NOTHING`, Functions, I-Regexp, Normalized Paths)](./docs/jsonpath-guide.md)
  - [Internal Architecture & Performance Engineering](./docs/architecture.md)
  - [Why Choose `piffero-plus`: Architecture, RFC 9535 & Performance Advantages](./docs/advantages.md)
- **Benchmark Reports**
  - [200 MiB Scale & Phase 5 Comparison (15 Scenarios + In-Memory, `resultType`, Functions & WebStream)](./docs/benchmarks/scale-200mb.md)
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
