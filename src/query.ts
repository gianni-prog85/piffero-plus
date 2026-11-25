import {
  evaluateInMemory,
  tokenizeJsonPath,
  PifferoError,
  PifferoJsonPathError,
} from "./handler/jsonpathEngine";

export { PifferoError, PifferoJsonPathError };

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

/**
 * Supported synchronous inputs for the browser/edge-safe `piffero-plus/query` entry point:
 * - In-memory JavaScript object or array
 * - Raw JSON `string`
 * - UTF-8 encoded JSON `Uint8Array`
 */
export type QueryInput = Record<string, any> | any[] | string | Uint8Array;

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Browser-, Edge-, Deno-, Bun-, and Node-safe synchronous JSONPath evaluator.
 *
 * Uses zero Node.js built-ins (`stream`, `fs`, `Buffer`) and zero dynamic code
 * evaluation (`eval` / `Function` / `vm`).
 *
 * @param input - In-memory JS object/array, JSON `string`, or UTF-8 `Uint8Array`.
 * @param jsonPath - RFC 9535 / Goessner JSONPath expression starting with `$` (defaults to `"$"`).
 * @param options - Optional query options (`resultType`: `"value"` | `"path"` | `"pointer"` | `"all"`).
 * @returns Array of matched values, Normalized Paths, JSON Pointers, or `{ path, pointer, value }` objects.
 * @throws {PifferoJsonPathError} If `jsonPath` has invalid syntax.
 * @throws {PifferoError} If `input` is not a supported type or contains malformed JSON.
 */
export function query<T = any>(
  input: QueryInput,
  jsonPath?: string,
  options?: { resultType?: "value" }
): T[];
export function query(
  input: QueryInput,
  jsonPath: string | undefined,
  options: { resultType: "path" | "pointer" }
): string[];
export function query<T = any>(
  input: QueryInput,
  jsonPath: string | undefined,
  options: { resultType: "all" }
): PifferoAllResult<T>[];
export function query<T = any>(
  input: QueryInput,
  jsonPath?: string,
  options?: PifferoQueryOptions
): T[];
export function query<T = any>(
  input: QueryInput,
  jsonPath: string = "$",
  options?: PifferoQueryOptions
): T[] {
  const steps = tokenizeJsonPath(jsonPath);
  const resultType: PifferoResultType =
    (options && options.resultType) || "value";

  let doc: any;
  if (typeof input === "string" || input instanceof Uint8Array) {
    const text = typeof input === "string" ? input : decodeUtf8(input);
    try {
      doc = JSON.parse(text);
    } catch (err) {
      throw new PifferoError(
        `Invalid JSON input: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (input !== null && typeof input === "object") {
    doc = input;
  } else {
    throw new PifferoError(
      "Invalid input: expected object, array, JSON string, or Uint8Array"
    );
  }

  return evaluateInMemory(doc, steps, resultType) as T[];
}

/**
 * Lightweight browser-safe `Piffero` namespace exposing `Piffero.query()`
 * as a drop-in match for the Node.js `Piffero.query()` API.
 */
export const Piffero = {
  query,
};

export default Piffero;
