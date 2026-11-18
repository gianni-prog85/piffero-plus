import { Readable, Stream } from "stream";
import { parse, MasterHandler } from "./handler/mastehandler";

/**
 * Output format for matched items:
 * - `"value"`: Matched JSON values (default).
 * - `"path"`: RFC 9535 §2.7 Normalized Paths (e.g. `"$['employees'][0]['name']"`).
 * - `"pointer"`: RFC 6901 JSON Pointers (e.g. `"/employees/0/name"`).
 * - `"all"`: Objects `{ path, pointer, value }` for each match.
 */
export type PifferoResultType = "value" | "path" | "pointer" | "all";

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

/**
 * Streaming SAX-like JSONPath parser for Node.js `Readable` streams.
 *
 * `Piffero` extracts values matching a Goessner or RFC 9535 JSONPath expression
 * directly from an input byte/text stream without loading the entire JSON
 * document into memory, always producing a valid JSON array (`[...]`) as output.
 */
export class Piffero {
  /**
   * Streams values (or paths) matching `jsonPath` from `stream` as a valid JSON array (`[...]`).
   *
   * Returns a backpressure-aware Node.js `Readable` stream (typed as `Stream`).
   * Upstream reading is paused when downstream buffers are full and automatically
   * terminated early once deterministic queries complete.
   *
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns A `Readable` stream emitting chunks of a JSON-serialized array (`[...]`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   *
   * @remarks
   * Malformed JSON input emits a `PifferoError` on the returned stream's `'error'` event.
   * Attach an `'error'` listener to both `stream` (source I/O errors) and the returned stream.
   */
  static findByPath(
    stream: Readable,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ): Stream {
    const handler = new MasterHandler();
    let parsedPath = parse(jsonPath);
    return handler.parse(stream, parsedPath, false, undefined, false, options);
  }

  /**
   * Extracts values (or paths) matching `jsonPath` from `stream` and passes the resulting
   * JSON array string (`"[...]"`) to `callback`.
   *
   * @param callback - Invoked on completion as `callback(result, err)`. On success,
   *   `result` is a JSON-encoded array string (`"[...]"`) and `err` is `null`.
   *   On malformed JSON input, `err` is a `PifferoError`.
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   */
  static findAsString(
    callback: (result, err?) => void,
    stream: Readable,
    jsonPath: string = "$",
    options?: PifferoQueryOptions
  ) {
    const handler = new MasterHandler();
    let parsedPath = parse(jsonPath);
    handler.parse(stream, parsedPath, true, callback, false, options);
  }

  /**
   * Promise-based wrapper around {@link Piffero.findAsString} that resolves with
   * the JSON-encoded array string (`"[...]"`) of all matched items.
   *
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @param options - Optional query options (e.g. `resultType`).
   * @returns A Promise resolving to a JSON array string (`"[...]"`) or rejecting with `PifferoError`.
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   */
  static findAsPromise(
    stream: Readable,
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
        stream,
        jsonPath,
        options
      );
    });
  }
}
