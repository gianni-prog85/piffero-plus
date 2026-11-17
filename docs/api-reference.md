# API Reference

`piffero-plus` exports the `Piffero` class as its public entry point ([`index.ts`](../index.ts), [`src/piffero.ts`](../src/piffero.ts)) and ships bundled TypeScript declarations (`dist/index.d.ts`).

---

## Installation & Imports

```bash
npm install piffero-plus
```

**CommonJS:**

```js
const { Piffero } = require("piffero-plus");
```

**TypeScript / ESM interop:**

```ts
import { Piffero } from "piffero-plus";
```

---

## `Piffero` Methods

All three methods are static on `Piffero` and accept any Node.js `Readable` stream (`fs.createReadStream`, HTTP `IncomingMessage`, `Readable.from(...)`, `zlib.createGunzip()`, etc.) containing UTF-8 JSON.

> **Output format contract:** Every method **always** outputs a valid JSON-serialized array string (`[...]`).
> - No matches → `"[]"`
> - Single match → `"[value]"`
> - Multiple matches → `"[value1,value2,...]"`
> - JSON `null` matches are preserved (`"[null]"`).
> - Wildcards, filters, and positive slices emit in document order; negative-step slices emit in reverse order; heterogeneous/ordered unions `[,]` emit in **exact selector order** including duplicates.

### `Piffero.findByPath(stream, jsonPath?)`

```ts
static findByPath(stream: Readable, jsonPath: string = "$"): Stream
```

Streams matched JSON values directly as a chunked, backpressure-aware Node.js `Readable` stream (typed as `Stream` in TypeScript).

- **Parameters**:
  - `stream: Readable` — Input stream carrying JSON text.
  - `jsonPath: string = "$"` — JSONPath query (must start with `$`). Defaults to `"$"`, which returns `[<entire root document>]`.
- **Returns**: `Stream` (a Node.js `Readable` instance at runtime) emitting chunks of a valid JSON array `[...]`.
- **Throws synchronously**: `PifferoJsonPathError` if `jsonPath` is syntactically invalid.
- **Emits asynchronously**: `'error'` with `PifferoError` if the JSON input is malformed.
- **Buffering & backpressure**: Output tokens are buffered in 4 KiB chunks (`STREAM_CHUNK_THRESHOLD = 4096`) before `output.push()`. If downstream returns `false` from `push()`, the upstream `stream` is paused and resumed automatically via the `read()` hook.
- **Early termination**: Deterministic queries (such as `$.[1].payload`, `$[0:10:2]`, or `$[2,0,2,1:3].id`) automatically `destroy()` and `unpipe()` the upstream `stream` as soon as all required matches are emitted.

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

### `Piffero.findAsString(callback, stream, jsonPath?)`

```ts
static findAsString(
  callback: (result: any, err?: any) => void,
  stream: Readable,
  jsonPath: string = "$"
): void
```

Collects all matched values and invokes `callback(result, err)` once parsing completes.

- **Parameters**:
  - `callback: (result, err?) => void` — Called on stream completion.
    - On success: `result` is the complete JSON array string (`"[...]"`), and `err` is `null`.
    - On malformed JSON: `err` is an instance of `PifferoError`.
  - `stream: Readable` — Input JSON stream.
  - `jsonPath: string = "$"` — JSONPath query.
- **Throws synchronously**: `PifferoJsonPathError` if `jsonPath` is syntactically invalid.
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

### `Piffero.findAsPromise(stream, jsonPath?)`

```ts
static findAsPromise(
  stream: Readable,
  jsonPath: string = "$"
): Promise<string>
```

Promise wrapper around `Piffero.findAsString` for `async`/`await` workflows.

- **Parameters**:
  - `stream: Readable` — Input JSON stream.
  - `jsonPath: string = "$"` — JSONPath query.
- **Returns**: `Promise<string>` — Resolves with the JSON array string (`"[...]"`); call `JSON.parse(result)` if you need JavaScript objects/values. Rejects with `PifferoError` if the JSON stream is malformed.
- **Throws synchronously**: `PifferoJsonPathError` if `jsonPath` is invalid (note: synchronous throw, **not** a rejected Promise, unless called inside an `async` function).

**Example:**

```ts
import * as fs from "fs";
import { Piffero } from "piffero-plus";

async function getActiveEmployeeNames(filePath: string): Promise<string[]> {
  try {
    const raw = await Piffero.findAsPromise(
      fs.createReadStream(filePath),
      "$.employees[?@.active == true].name"
    );
    return JSON.parse(raw);
  } catch (err) {
    // Catches both synchronous PifferoJsonPathError (inside async fn) and rejected PifferoError
    console.error("Failed to extract names:", err);
    throw err;
  }
}
```

---

## Error Types & Handling

`piffero-plus` cleanly separates query-compilation errors from stream-parsing errors:

| Error Class | When It Occurs | Delivery Mechanism |
|---|---|---|
| `PifferoJsonPathError` | Invalid JSONPath syntax (not starting with `$`, unclosed brackets/quotes, invalid I-JSON integer, unknown function or invalid argument type, malformed filter/script expression) | **Thrown synchronously** by `findByPath`, `findAsString`, and `findAsPromise` before reading the stream |
| `PifferoError` | Malformed JSON input detected by `CStream` (e.g., unexpected EOF, invalid number/token, trailing characters) | Emitted on `'error'` (`findByPath`), passed as 2nd callback argument (`findAsString`), or rejects the Promise (`findAsPromise`) |

> **Importing error classes:** The top-level package entry ([`index.ts`](../index.ts)) exports `{ Piffero }`. If you need `instanceof` checks against `PifferoJsonPathError` or `PifferoError`, you can inspect `err.name` / `err.constructor.name` or import them from `piffero-plus/dist/src/handler/mastehandler` (TypeScript source: [`src/handler/mastehandler.ts`](../src/handler/mastehandler.ts)).

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
| Small/medium matched output from a huge input file (point lookup, slice, count-limited matches) | `Piffero.findAsPromise()` or `Piffero.findAsString()` | Uses 16 KiB string buffers with zero `Readable` stream wrapper overhead (**~0.45–0.55 ms** on early-file 200 MiB lookups) |
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

## Related Documentation

- [JSONPath Syntax & RFC 9535 Semantics Guide](./jsonpath-guide.md)
- [Internal Architecture & Performance Optimizations](./architecture.md)
- [Why Choose `piffero-plus`](./advantages.md)
- [200 MiB Scale Benchmarks](./benchmarks/scale-200mb.md)
