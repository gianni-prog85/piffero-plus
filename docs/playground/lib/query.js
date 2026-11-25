import { evaluateInMemory, tokenizeJsonPath, PifferoError, PifferoJsonPathError, } from "./handler/jsonpathEngine.js";
export { PifferoError, PifferoJsonPathError };
function decodeUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(bytes);
    }
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
    }
    return out;
}
export function query(input, jsonPath = "$", options) {
    const steps = tokenizeJsonPath(jsonPath);
    const resultType = (options && options.resultType) || "value";
    let doc;
    if (typeof input === "string" || input instanceof Uint8Array) {
        const text = typeof input === "string" ? input : decodeUtf8(input);
        try {
            doc = JSON.parse(text);
        }
        catch (err) {
            throw new PifferoError(`Invalid JSON input: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    else if (input !== null && typeof input === "object") {
        doc = input;
    }
    else {
        throw new PifferoError("Invalid input: expected object, array, JSON string, or Uint8Array");
    }
    return evaluateInMemory(doc, steps, resultType);
}
/**
 * Lightweight browser-safe `Piffero` namespace exposing `Piffero.query()`
 * as a drop-in match for the Node.js `Piffero.query()` API.
 */
export const Piffero = {
    query,
};
export default Piffero;
