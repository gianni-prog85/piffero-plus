import { Readable, Stream } from "stream";
import { parse, MasterHandler } from "./handler/mastehandler";

/**
 * Streaming SAX-like JSONPath parser for Node.js `Readable` streams.
 *
 * `Piffero` extracts values matching a Goessner or RFC 9535 JSONPath expression
 * directly from an input byte/text stream without loading the entire JSON
 * document into memory, always producing a valid JSON array (`[...]`) as output.
 */
export class Piffero {
  /**
   * Streams values matching `jsonPath` from `stream` as a valid JSON array (`[...]`).
   *
   * Returns a backpressure-aware Node.js `Readable` stream (typed as `Stream`).
   * Upstream reading is paused when downstream buffers are full and automatically
   * terminated early once deterministic queries complete.
   *
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @returns A `Readable` stream emitting chunks of a JSON-serialized array (`[...]`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   *
   * @remarks
   * Malformed JSON input emits a `PifferoError` on the returned stream's `'error'` event.
   * Attach an `'error'` listener to both `stream` (source I/O errors) and the returned stream.
   */
  static findByPath(stream: Readable, jsonPath: string = "$"): Stream {
    const handler = new MasterHandler();
    let parsedPath = parse(jsonPath);
    return handler.parse(stream, parsedPath);
  }

  /**
   * Extracts values matching `jsonPath` from `stream` and passes the resulting
   * JSON array string (`"[...]"`) to `callback`.
   *
   * @param callback - Invoked on completion as `callback(result, err)`. On success,
   *   `result` is a JSON-encoded array string (`"[...]"`) and `err` is `null`.
   *   On malformed JSON input, `err` is a `PifferoError`.
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   */
  static findAsString(
    callback: (result, err?) => void,
    stream: Readable,
    jsonPath: string = "$"
  ) {
    const handler = new MasterHandler();
    let parsedPath = parse(jsonPath);
    handler.parse(stream, parsedPath, true, callback);
  }

  /**
   * Promise-based wrapper around {@link Piffero.findAsString} that resolves with
   * the JSON-encoded array string (`"[...]"`) of all matched values.
   *
   * @param stream - Readable input stream containing a valid JSON document.
   * @param jsonPath - JSONPath expression starting with `$` (defaults to `"$"`).
   * @returns A Promise resolving to a JSON array string (`"[...]"`) or rejecting with `PifferoError`.
   * @throws {PifferoJsonPathError} Synchronously if `jsonPath` has invalid syntax.
   */
  static findAsPromise(
    stream: Readable,
    jsonPath: string = "$"
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
        jsonPath
      );
    });
  }
}
