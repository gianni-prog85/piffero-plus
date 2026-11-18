# API Reference

`piffero-plus` exports `Piffero`, `PifferoError`, `PifferoJsonPathError`, and TypeScript helper types (`PifferoInput`, `WebReadableStreamLike`, `PifferoResultType`, `PifferoQueryOptions`) from its public entry point ([`index.ts`](../index.ts), [`src/piffero.ts`](../src/piffero.ts)) and ships bundled TypeScript declarations (`dist/index.d.ts`).

---

## Installation & Imports

```bash
npm install piffero-plus
```

**CommonJS:**

```js
const { Piffero, PifferoError, PifferoJsonPathError } = require("piffero-plus");
```

**TypeScript / ESM interop:**

```ts
import {
  Piffero,
  PifferoError,
  PifferoJsonPathError,
  PifferoInput,
  WebReadableStreamLike,
  PifferoResultType,
  PifferoQueryOptions,
} from "piffero-plus";
```

---

## Input Sources (`PifferoInput`) & Query Options (`PifferoQueryOptions`)

### `PifferoInput`

```ts
export type PifferoInput =
  | Readable
  | WebReadableStreamLike<Uint8Array | string>
  | string
  | Buffer
  | Uint8Array
  | Record<string, any>
  | any[];
```

`Piffero.findByPath`, `Piffero.findAsString`, and `Piffero.findAsPromise` accept any `PifferoInput`:
1. **Node.js `Readable` stream**: `fs.createReadStream()`, HTTP `IncomingMessage`, `Readable.from(...)`, `zlib.createGunzip()`, etc.
2. **WHATWG Web `ReadableStream`**: e.g. `fetch(url).then(res => res.body)` in Node 18–24+, Deno, Bun, and Edge runtimes (`{ getReader() }`). Automatically handles backpressure and calls `reader.cancel()` on early stream termination.
3. **Raw JSON `string`, `Buffer`, or `Uint8Array`**: Processed synchronously via `MasterHandler.parseSync` in `findAsString`/`findAsPromise`/`query` without intermediate `Readable` stream event overhead.
4. **In-memory JavaScript object or array**: Evaluated directly via `evaluateInMemory` without `JSON.stringify` / `JSON.parse` round-trips.

### `PifferoQueryOptions` & `PifferoResultType`

```ts
export type PifferoResultType = "value" | "path" | "pointer" | "all";

export interface PifferoQueryOptions {
  resultType?: PifferoResultType;
}
```

- **`"value"` (default)**: Emits matched JSON values (zero path-tracking overhead).
- **`"path"`**: Emits canonical [RFC 9535 §2.7 Normalized Paths](https://www.rfc-editor.org/rfc/rfc9535#section-2.7) (e.g. `"$['employees'][0]['name']"`). Uses single-quoted member names with minimal escapes (`\b`, `\f`, `\n`, `\r`, `\t`, `\'`, `\\`, `\u00XX`) and non-negative bracket indices `[i]`.
- **`"pointer"`**: Emits [RFC 6901 JSON Pointers](https://www.rfc-editor.org/rfc/rfc6901) (e.g. `"/employees/0/name"`, with `~` escaped as `~0` and `/` escaped as `~1`; root `$` is `""`).
- **`"all"`**: Emits `{ path, pointer, value }` objects for each match.

---

## `Piffero` Methods

> **Output format contract:**
> - `findByPath`, `findAsString`, and `findAsPromise` **always** output a valid JSON-serialized array string (`[...]`).
> - `Piffero.query()` **always** returns a JavaScript array (`any[]`) directly.
> - No matches → `"[]"` (or `[]`)
> - Single match → `"[value]"` (or `[value]`)
> - Multiple matches → `"[value1,value2,...]"` (or `[value1, value2, ...]`)
> - JSON `null` matches are preserved (`"[null]"` / `[null]`).
> - Wildcards, filters, and positive slices emit in document order; negative-step slices emit in reverse order; heterogeneous/ordered unions `[,]` emit in **exact selector order** including duplicates.

### `Piffero.findByPath(input, jsonPath?, options?)`

```ts
static findByPath(
  input: PifferoInput,
  jsonPath: string = "$",
  options?: PifferoQueryOptions
): Stream
```

Streams matched JSON values (or paths) directly as a chunked, backpressure-aware Node.js `Readable` stream (typed as `Stream` in TypeScript).

- **Parameters**:
  - `input: PifferoInput` — Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`/`Uint8Array`, or JS object/array.
  - `jsonPath: string = "$"` — JSONPath query (must start with `$`). Defaults to `"$"`, which returns `[<entire root document>]`.
  - `options?: PifferoQueryOptions` — Optional `{ resultType?: "value" | "path" | "pointer" | "all" }`.
- **Returns**: `Stream` (a Node.js `Readable` instance at runtime) emitting chunks of a valid JSON array `[...]`.
- **Throws synchronously**:
  - `PifferoJsonPathError` if `jsonPath` is syntactically invalid.
  - `PifferoError` if `input` is not a supported source type.
- **Emits asynchronously**: `'error'` with `PifferoError` if the JSON input is malformed.
- **Buffering & backpressure**: Output tokens are buffered in 4 KiB chunks (`STREAM_CHUNK_THRESHOLD = 4096`) before `output.push()`. If downstream returns `false` from `push()`, the upstream stream is paused and resumed automatically via the `read()` hook.
- **Early termination**: Deterministic queries (such as `$.[1].payload`, `$[0:10:2]`, or `$[2,0,2,1:3].id`) automatically `destroy()`/`unpipe()` a Node `Readable` or `reader.cancel()` a Web `ReadableStream` as soon as all required matches are emitted.

**Example (file-to-file / pipeline):**

```js
const fs = require("fs");
const { pipeline } = require("stream");
const { Piffero } = require("piffero-plus");

const source = fs.createReadStream("./huge-events.json");
const extracted = Piffero.findByPath(source, "$[?@.type == 'IssuesEvent'].id");
const destination = fs.createWriteStream("./issue-ids.json");

// Attach an error handler to source as well, because pipe() does not forward upstream I/O errors
source.on("error", (err) => {
  console.error("Source stream error:", err);
  extracted.destroy(err);
});

pipeline(extracted, destination, (err) => {
  if (err) {
    console.error("Extraction failed:", err);
  } else {
    console.log("Done writing issue-ids.json");
  }
});
```

---

### `Piffero.findAsString(callback, input, jsonPath?, options?)`

```ts
static findAsString(
  callback: (result: any, err?: any) => void,
  input: PifferoInput,
  jsonPath: string = "$",
  options?: PifferoQueryOptions
): void
```

Collects all matched values (or paths) and invokes `callback(result, err)` once parsing completes.

- **Parameters**:
  - `callback: (result, err?) => void` — Called on completion.
    - On success: `result` is the complete JSON array string (`"[...]"`), and `err` is `null`.
    - On malformed JSON: `err` is an instance of `PifferoError`.
  - `input: PifferoInput` — Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`/`Uint8Array`, or JS object/array.
  - `jsonPath: string = "$"` — JSONPath query.
  - `options?: PifferoQueryOptions` — Optional `{ resultType?: "value" | "path" | "pointer" | "all" }`.
- **Throws synchronously**: `PifferoJsonPathError` if `jsonPath` is syntactically invalid, or `PifferoError` if `input` is not a valid input type.
- **Internal chunking**: Uses 16 KiB string segment joins (`STRING_CHUNK_THRESHOLD = 16384`) before assembling the final string, making it the fastest option when the *matched output* fits comfortably in memory (e.g., extracting one or a few records from a 200+ MiB file).

**Example:**

```js
const fs = require("fs");
const { Piffero } = require("piffero-plus");

Piffero.findAsString(
  (result, err) => {
    if (err) {
      console.error("JSON error:", err.message);
      return;
    }
    const items = JSON.parse(result);
    console.log("Matched count:", items.length);
  },
  fs.createReadStream("./employees.json"),
  "$.employees[?@.active == true].name"
);
```

---

### `Piffero.findAsPromise(input, jsonPath?, options?)`

```ts
static findAsPromise(
  input: PifferoInput,
  jsonPath: string = "$",
  options?: PifferoQueryOptions
): Promise<string>
```

Promise wrapper around `Piffero.findAsString` for `async`/`await` workflows.

- **Parameters**:
  - `input: PifferoInput` — Node `Readable`, Web `ReadableStream` (`fetch().body`), JSON `string`/`Buffer`/`Uint8Array`, or JS object/array.
  - `jsonPath: string = "$"` — JSONPath query.
  - `options?: PifferoQueryOptions` — Optional `{ resultType?: "value" | "path" | "pointer" | "all" }`.
- **Returns**: `Promise<string>` — Resolves with the JSON array string (`"[...]"`); call `JSON.parse(result)` if you need JavaScript objects/values. Rejects with `PifferoError` if the JSON input is malformed.
- **Throws synchronously / rejects**: Rejects with `PifferoJsonPathError` if `jsonPath` is invalid (because `findAsString` is invoked inside the `new Promise` executor).

**Example (Node `Readable` & `fetch()` Web `ReadableStream`):**

```ts
import * as fs from "fs";
import { Piffero } from "piffero-plus";

async function getActiveEmployeeNames(filePath: string): Promise<string[]> {
  const raw = await Piffero.findAsPromise(
    fs.createReadStream(filePath),
    "$.employees[?@.active == true].name"
  );
  return JSON.parse(raw);
}

async function fetchFirstTwoEventPaths(url: string): Promise<string[]> {
  const res = await fetch(url);
  // Streams directly from WHATWG ReadableStream and cancels early after index 1!
  const raw = await Piffero.findAsPromise(res.body!, "$[0:2].id", {
    resultType: "path",
  });
  return JSON.parse(raw); // ["$[0]['id']", "$[1]['id']"]
}
```

---

### `Piffero.query(input, jsonPath?, options?)`

```ts
static query(
  input: Record<string, any> | any[] | string | Buffer | Uint8Array,
  jsonPath: string = "$",
  options?: PifferoQueryOptions
): any[]
```

Synchronously evaluates `jsonPath` against an in-memory JavaScript object/array, JSON `string`, `Buffer`, or `Uint8Array`, returning an array of matched JS values (or paths) directly.

- **Parameters**:
  - `input: Record<string, any> | any[] | string | Buffer | Uint8Array` — Already-parsed JS object/array or raw JSON `string`/`Buffer`/`Uint8Array`.
  - `jsonPath: string = "$"` — JSONPath query (defaults to `"$"`).
  - `options?: PifferoQueryOptions` — Optional `{ resultType?: "value" | "path" | "pointer" | "all" }`.
- **Returns**: `any[]` — Array of matched JS values (`"value"`), Normalized Path strings (`"path"`), JSON Pointer strings (`"pointer"`), or `{ path, pointer, value }` objects (`"all"`).
- **Throws synchronously**:
  - `PifferoJsonPathError` if `jsonPath` is syntactically invalid.
  - `PifferoError` if `input` is a stream (`Readable` / `ReadableStream`), `null`/primitive, or contains malformed JSON.

**Example:**

```ts
import { Piffero } from "piffero-plus";

const doc = {
  employees: [
    { name: "John", active: true, tags: ["dev", "ts"] },
    { name: "Joe", active: false, tags: ["ops"] },
  ],
};

// Direct JS values
const activeNames = Piffero.query(doc, "$.employees[?@.active == true].name");
// => ["John"]

// Canonical RFC 9535 §2.7 Normalized Paths
const tagPaths = Piffero.query(doc, "$..tags[*]", { resultType: "path" });
// => ["$['employees'][0]['tags'][0]", "$['employees'][0]['tags'][1]", "$['employees'][1]['tags'][0]"]

// Combined { path, pointer, value }
const details = Piffero.query(doc, "$.employees[0].name", { resultType: "all" });
// => [{ path: "$['employees'][0]['name']", pointer: "/employees/0/name", value: "John" }]
```

---

## Error Types & Handling

`piffero-plus` cleanly separates query-compilation errors from JSON-parsing errors:

| Error Class | When It Occurs | Delivery Mechanism |
|---|---|---|
| `PifferoJsonPathError` | Invalid JSONPath syntax (not starting with `$`, unclosed brackets/quotes, invalid I-JSON integer, unknown function or invalid argument type, malformed filter/script expression) | **Thrown synchronously** by `findByPath`, `findAsString`, and `query` (and rejects `findAsPromise`) before reading the input |
| `PifferoError` | Malformed JSON input detected by `CStream` (e.g., unexpected EOF, invalid number/token, trailing characters) or unsupported `input` type | Emitted on `'error'` (`findByPath`), passed as 2nd callback argument (`findAsString`), rejects the Promise (`findAsPromise`), or thrown synchronously (`query`) |

> **Importing error classes:** Both `PifferoJsonPathError` and `PifferoError` are exported directly from `'piffero-plus'` ([`index.ts`](../index.ts)) for `instanceof` checks.

### Validating JSONPath Early in HTTP Endpoints

Because `PifferoJsonPathError` is thrown synchronously, wrap `Piffero.findByPath(...)` in `try/catch` to return `400 Bad Request` before headers or stream data are sent:

```ts
import * as fs from "fs";
import * as express from "express";
import { Piffero } from "piffero-plus";

const app = express();

app.get("/api/query", (req, res) => {
  const jsonPath = String(req.query.path || "$");
  const inputStream = fs.createReadStream("./data.json");

  let resultStream;
  try {
    resultStream = Piffero.findByPath(inputStream, jsonPath);
  } catch (err: any) {
    inputStream.destroy();
    res.status(400).json({ error: err.message });
    return;
  }

  inputStream.on("error", (err) => {
    resultStream.destroy(err);
  });

  resultStream.on("error", (err: any) => {
    if (!res.headersSent) {
      res.status(422).json({ error: err.message });
    } else {
      res.destroy(err);
    }
  });

  res.setHeader("Content-Type", "application/json");
  resultStream.pipe(res);
});
```

---

## Choosing the Right Method

| Scenario | Recommended Method | Why |
|---|---|---|
| Large matched output (thousands of records) or HTTP / file pass-through | `Piffero.findByPath()` | Streams 4 KiB JSON chunks incrementally with backpressure; never materializes the full output string in memory |
| Small/medium matched output from a huge input stream (`fs.createReadStream`, `fetch().body`) | `Piffero.findAsPromise()` or `Piffero.findAsString()` | Uses 16 KiB string buffers with zero `Readable` stream wrapper overhead (**~0.45–0.55 ms** on early-file 200 MiB lookups) |
| In-memory JS objects/arrays or synchronous `string`/`Buffer` payloads | `Piffero.query()` | Evaluates directly in-memory (**~3.0x–3.6x faster** than `jsonpath-plus`) or via `parseSync` and returns `any[]` directly |
| Legacy callback codebase | `Piffero.findAsString()` | Direct `(result, err)` callback without Promise allocation |

---

## Processing Compressed Streams (`.json.gz`)

Because `Piffero` accepts any Node.js `Readable`, you can stream compressed JSON directly through `zlib`:

```js
const fs = require("fs");
const zlib = require("zlib");
const { Piffero } = require("piffero-plus");

const gunzip = fs.createReadStream("./events.json.gz").pipe(zlib.createGunzip());
const out = Piffero.findByPath(gunzip, "$[0:50].actor.login");
out.pipe(process.stdout);
```

---

## Command-Line Interface (`npx piffero-plus`)

`piffero-plus` includes a streaming CLI (`piffero-plus` / `piffero` binary in `package.json`, backed by [`runCli()`](../src/cli.ts)):

```bash
# Stream from a file
npx piffero-plus '$.employees[?@.active == true].name' ./employees.json

# Stream from stdin with RFC 9535 Normalized Paths (--path) and pretty output (--pretty)
cat ./employees.json | npx piffero-plus '$..number' --path --pretty

# Output RFC 6901 JSON Pointers (--pointer) or combined objects (--all)
npx piffero-plus '$.employees[0].name' ./employees.json --all
```

| Flag | Description |
|---|---|
| `-r, --result-type <type>` | Output mode: `value` (default), `path`, `pointer`, or `all` |
| `--path` | Shorthand for `--result-type path` (RFC 9535 §2.7 Normalized Paths) |
| `--pointer` | Shorthand for `--result-type pointer` (RFC 6901 JSON Pointers) |
| `--all` | Shorthand for `--result-type all` (`{ path, pointer, value }`) |
| `-p, --pretty` | Pretty-print the output JSON array (`2`-space indentation) |
| `-v, --version` | Print package version |
| `-h, --help` | Print CLI usage help |

---

## Related Documentation

- [JSONPath Syntax & RFC 9535 Semantics Guide](./jsonpath-guide.md)
- [Internal Architecture & Performance Optimizations](./architecture.md)
- [Why Choose `piffero-plus`](./advantages.md)
- [200 MiB Scale Benchmarks](./benchmarks/scale-200mb.md)
