import { Readable, Stream } from "stream";
import { parse, MasterHandler, PifferoError } from "./handler/mastehandler";
import { evaluateInMemory } from "./handler/jsonpathEngine";
import { JsonArrayItemSplitter } from "./utils/jsonArraySplitter";

/**
 * Minimal structural interface for WHATWG Web `ReadableStream` (e.g. `fetch().body`),
 * compatible across Node.js 18+, Deno, Bun, and browser runtimes without requiring DOM libs.
 */
export interface WebReadableStreamLike<R = any> {
  getReader(): {
    read(): Promise<{ done: boolean; value?: R }>;
    cancel(reason?: any): Promise<any>;
  };
}

/**
 * Any supported input source for `Piffero`:
 * - Node.js `Readable` stream (e.g. `fs.createReadStream`, `zlib`, sockets)
 * - WHATWG Web `ReadableStream` (e.g. `fetch(url).then(r => r.body)`)
 * - Raw JSON `string`, `Buffer`, or `Uint8Array`
 * - In-memory JavaScript object or array
 */
export type PifferoInput =
  | Readable
  | WebReadableStreamLike<Uint8Array | string>
  | string
  | Buffer
  | Uint8Array
  | Record<string, any>
  | any[];

/**
 * Output format for matched items:
 * - `"value"`: Matched JSON values (default).
 * - `"path"`: RFC 9535 §2.7 Normalized Paths (e.g. `"$['employees'][0]['name']"`).
 * - `"pointer"`: RFC 6901 JSON Pointers (e.g. `"/employees/0/name"`).
 * - `"all"`: Objects `{ path, pointer, value }` for each match.
 */
export type PifferoResultType = "value" | "path" | "pointer" | "all";

/**
 * Combined result object emitted when `resultType` is `"all"`.
 */
export interface PifferoAllResult<T = any> {
  path: string;
  pointer: string;
  value: T;
}

/**
 * Optional configuration for `Piffero` query methods.
 */
export interface PifferoQueryOptions {
  /**
   * Controls what each element in the returned JSON array represents.
   * Defaults to `"value"`.
   */
  resultType?: PifferoResultType;
}

function isNodeReadable(input: any): input is Readable {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof input.pipe === "function"
  );
}

function isWebReadableStream(input: any): input is WebReadableStreamLike {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof input.getReader === "function"
  );
}

function isBinaryOrString(
  input: any
): input is string | Buffer | Uint8Array {
  return (
    typeof input === "string" ||
    Buffer.isBuffer(input) ||
    input instanceof Uint8Array
  );
}

function toBuffer(input: string | Buffer | Uint8Array): Buffer {
  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }
  if (Buffer.isBuffer(input)) {
    return input;
  }
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function webStreamToNodeReadable(webStream: WebReadableStreamLike): Readable {
  const reader = webStream.getReader();
  let reading = false;
  let cancelled = false;
  const nodeStream = new Readable({
    read() {
      if (reading || cancelled) {
        return;
      }
      reading = true;
      const pump = () => {
        reader.read().then(
          ({ done, value }) => {
            if (cancelled) {
              return;
            }
            if (done) {
              reading = false;
              nodeStream.push(null);
              return;
            }
            const chunk =
              typeof value === "string"
                ? Buffer.from(value, "utf8")
                : Buffer.isBuffer(value)
                ? value
                : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            if (nodeStream.push(chunk)) {
              pump();
            } else {
              reading = false;
            }
          },
          (err) => {
            reading = false;
            if (!cancelled) {
              nodeStream.destroy(err);
            }
          }
        );
      };
      pump();
    },
    destroy(err, cb) {
      cancelled = true;
      Promise.resolve(reader.cancel(err)).then(
        () => cb(err),
        () => cb(err)
      );
    },
  });
  return nodeStream;
}

/**
 * Streaming SAX-like JSONPath parser for Node.js `Readable` streams,
 * Web `ReadableStream`s (`fetch`), raw `string`/`Buffer` payloads, and in-memory JS values.
 *
 * `Piffero` extracts values matching a Goessner or RFC 9535 JSONPath expression
 * without loading large documents into memory, producing a valid JSON array (`[...]`)
 * or direct JS array via {@link Piffero.query}.
 */
export class Piffero {
  /**
   * Streams values (or paths) matching `jsonPath` from `input` as a valid JSON array (`[...]`).
   *
   * Returns a backpressure-aware Node.js `Readable` stream (typed as `Stream`).
   * Upstream reading is paused when downstream buffers are full and automatically
   * terminated early once deterministic queries complete.
   *
   * @param input - Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`, or JS object/array.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns A `Readable` stream emitting chunks of a JSON-serialized array (`[...]`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   * @throws {PifferoError} Synchronously if `input` is not a supported source type.
   *
   * @remarks
   * Malformed JSON input emits a `PifferoError` on the returned stream's `'error'` event.
   * Attach an `'error'` listener to both `input` (for Node `Readable` I/O errors) and the returned stream.
   */
  static findByPath(
    input: PifferoInput,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ): Stream {
    const parsedPath = parse(jsonPath);
    const resultType = (options && options.resultType) || "value";

    if (isNodeReadable(input)) {
      return new MasterHandler().parse(
        input,
        parsedPath,
        false,
        undefined,
        false,
        options
      );
    }
    if (isWebReadableStream(input)) {
      return new MasterHandler().parse(
        webStreamToNodeReadable(input),
        parsedPath,
        false,
        undefined,
        false,
        options
      );
    }
    if (isBinaryOrString(input)) {
      return new MasterHandler().parse(
        Readable.from([toBuffer(input)]),
        parsedPath,
        false,
        undefined,
        false,
        options
      );
    }
    if (input !== null && typeof input === "object") {
      const results = evaluateInMemory(
        input,
        parsedPath.steps || [],
        resultType
      );
      const out = new Readable({ read() {} });
      out.push(Buffer.from(JSON.stringify(results), "utf8"));
      out.push(null);
      return out;
    }
    throw new PifferoError(
      "Invalid input: expected Readable stream, Web ReadableStream, string, Buffer, or JSON object/array"
    );
  }

  /**
   * Extracts values (or paths) matching `jsonPath` from `input` and passes the resulting
   * JSON array string (`"[...]"`) to `callback`.
   *
   * @param callback - Invoked on completion as `callback(result, err)`. On success,
   *   `result` is a JSON-encoded array string (`"[...]"`) and `err` is `null`.
   *   On malformed JSON input, `err` is a `PifferoError`.
   * @param input - Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`, or JS object/array.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   * @throws {PifferoError} Synchronously if `input` is not a supported source type.
   */
  static findAsString(
    callback: (result, err?) => void,
    input: PifferoInput,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ) {
    const parsedPath = parse(jsonPath);
    const resultType = (options && options.resultType) || "value";

    if (isNodeReadable(input)) {
      new MasterHandler().parse(input, parsedPath, true, callback, false, options);
      return;
    }
    if (isWebReadableStream(input)) {
      new MasterHandler().parse(
        webStreamToNodeReadable(input),
        parsedPath,
        true,
        callback,
        false,
        options
      );
      return;
    }
    if (isBinaryOrString(input)) {
      try {
        const res = new MasterHandler().parseSync(input, parsedPath, options);
        callback(res, null);
      } catch (err) {
        callback("", err);
      }
      return;
    }
    if (input !== null && typeof input === "object") {
      const results = evaluateInMemory(
        input,
        parsedPath.steps || [],
        resultType
      );
      callback(JSON.stringify(results), null);
      return;
    }
    throw new PifferoError(
      "Invalid input: expected Readable stream, Web ReadableStream, string, Buffer, or JSON object/array"
    );
  }

  /**
   * Promise-based wrapper around {@link Piffero.findAsString} that resolves with
   * the JSON-encoded array string (`"[...]"`) of all matched items.
   *
   * @param input - Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`, or JS object/array.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns A Promise resolving to a JSON array string (`"[...]"`) or rejecting with `PifferoError`.
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   */
  static findAsPromise(
    input: PifferoInput,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      Piffero.findAsString(
        (result, err) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        },
        input,
        jsonPath,
        options
      );
    });
  }

  /**
   * Synchronously evaluates `jsonPath` against an in-memory JavaScript object/array,
   * JSON `string`, `Buffer`, or `Uint8Array`, returning an array of matched JS values (or paths).
   *
   * @param input - In-memory JS object/array or JSON `string`/`Buffer`/`Uint8Array`.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns Array of matched JS values, Normalized Paths, JSON Pointers, or `{ path, pointer, value }` objects.
   * @throws {PifferoJsonPathError} If `jsonPath` has invalid syntax.
   * @throws {PifferoError} If `input` is a stream or contains malformed JSON.
   */
  static query<T = any>(
    input: Record<string, any> | any[] | string | Buffer | Uint8Array,
    jsonPath?: string,
    options?: { resultType?: "value" }
  ): T[];
  static query(
    input: Record<string, any> | any[] | string | Buffer | Uint8Array,
    jsonPath: string | undefined,
    options: { resultType: "path" | "pointer" }
  ): string[];
  static query<T = any>(
    input: Record<string, any> | any[] | string | Buffer | Uint8Array,
    jsonPath: string | undefined,
    options: { resultType: "all" }
  ): PifferoAllResult<T>[];
  static query<T = any>(
    input: Record<string, any> | any[] | string | Buffer | Uint8Array,
    jsonPath?: string,
    options?: PifferoQueryOptions
  ): T[];
  static query<T = any>(
    input: Record<string, any> | any[] | string | Buffer | Uint8Array,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ): T[] {
    const parsedPath = parse(jsonPath);
    const resultType = (options && options.resultType) || "value";

    if (isNodeReadable(input) || isWebReadableStream(input)) {
      throw new PifferoError(
        "Piffero.query() only supports synchronous inputs (object, array, string, Buffer); use findByPath(), findAsPromise(), or iterate() for streams"
      );
    }
    if (isBinaryOrString(input)) {
      const raw = new MasterHandler().parseSync(input, parsedPath, options);
      return JSON.parse(raw) as T[];
    }
    if (input !== null && typeof input === "object") {
      return evaluateInMemory(
        input,
        parsedPath.steps || [],
        resultType
      ) as T[];
    }
    throw new PifferoError(
      "Invalid input: expected object, array, string, Buffer, or Uint8Array"
    );
  }

  /**
   * Streams matched items as an `AsyncIterableIterator` for `for await...of` consumption,
   * with automatic backpressure and immediate upstream cancellation on early `break`/`return`.
   *
   * @param input - Node `Readable`, Web `ReadableStream`, JSON `string`/`Buffer`, or JS object/array.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns An `AsyncIterableIterator` yielding each matched JS value, path, pointer, or `{ path, pointer, value }`.
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   * @throws {PifferoError} Synchronously if `input` is not a supported source type, or asynchronously on malformed JSON.
   */
  static iterate<T = any>(
    input: PifferoInput,
    jsonPath?: string,
    options?: { resultType?: "value" }
  ): AsyncIterableIterator<T>;
  static iterate(
    input: PifferoInput,
    jsonPath: string | undefined,
    options: { resultType: "path" | "pointer" }
  ): AsyncIterableIterator<string>;
  static iterate<T = any>(
    input: PifferoInput,
    jsonPath: string | undefined,
    options: { resultType: "all" }
  ): AsyncIterableIterator<PifferoAllResult<T>>;
  static iterate<T = any>(
    input: PifferoInput,
    jsonPath?: string,
    options?: PifferoQueryOptions
  ): AsyncIterableIterator<T>;
  static iterate<T = any>(
    input: PifferoInput,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ): AsyncIterableIterator<T> {
    const parsedPath = parse(jsonPath);
    const resultType = (options && options.resultType) || "value";

    const isNode = isNodeReadable(input);
    const isWeb = !isNode && isWebReadableStream(input);
    const isBin = !isNode && !isWeb && isBinaryOrString(input);
    const isObj =
      !isNode && !isWeb && !isBin && input !== null && typeof input === "object";

    if (!isNode && !isWeb && !isBin && !isObj) {
      throw new PifferoError(
        "Invalid input: expected Readable stream, Web ReadableStream, string, Buffer, or JSON object/array"
      );
    }

    if (isObj) {
      const results = evaluateInMemory(
        input,
        parsedPath.steps || [],
        resultType
      ) as T[];
      return (async function* () {
        for (let i = 0; i < results.length; i++) {
          yield results[i];
        }
      })();
    }

    const outStream = (
      isNode
        ? new MasterHandler().parse(
            input as Readable,
            parsedPath,
            false,
            undefined,
            false,
            options
          )
        : isWeb
        ? new MasterHandler().parse(
            webStreamToNodeReadable(input as WebReadableStreamLike),
            parsedPath,
            false,
            undefined,
            false,
            options
          )
        : new MasterHandler().parse(
            Readable.from([toBuffer(input as string | Buffer | Uint8Array)]),
            parsedPath,
            false,
            undefined,
            false,
            options
          )
    ) as Readable;

    const nodeInput = isNode ? (input as Readable) : null;
    const onInputError = (err: Error) => {
      if (!outStream.destroyed) {
        outStream.destroy(err);
      }
    };
    if (nodeInput) {
      nodeInput.on("error", onInputError);
    }

    return (async function* () {
      const splitter = new JsonArrayItemSplitter();
      try {
        for await (const chunk of outStream) {
          const items = splitter.push(chunk as Buffer | string);
          for (let i = 0; i < items.length; i++) {
            yield JSON.parse(items[i]) as T;
          }
        }
        const tailItems = splitter.end();
        for (let i = 0; i < tailItems.length; i++) {
          yield JSON.parse(tailItems[i]) as T;
        }
      } finally {
        if (nodeInput) {
          nodeInput.removeListener("error", onInputError);
        }
        if (!outStream.destroyed) {
          outStream.destroy();
        }
      }
    })();
  }
}
