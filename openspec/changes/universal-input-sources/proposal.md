# Proposal: Input Universale (Node `Readable`, Web `ReadableStream`, `string`/`Buffer` e Oggetti JS)

## Why
In molte applicazioni Node.js e TypeScript moderne i dati JSON provengono da fonti eterogenee:
1. Stream Node.js `Readable` (`fs.createReadStream`, `zlib`, socket).
2. Web `ReadableStream` standard WHATWG (es. `fetch(url).then(r => r.body)` nativo in Node 18–24).
3. `string`, `Buffer` o `Uint8Array` già presenti in memoria.
4. Oggetti o array JavaScript già deserializzati in memoria.

Attualmente `piffero-plus` accetta solo `Readable` di Node.js, costringendo gli sviluppatori a convertire manualmente `fetch().body` o a installare una seconda libreria (come `jsonpath-plus`) per interrogare oggetti JS già in RAM.

## What Changes
- Definire un tipo unione `PifferoInput`:
  ```ts
  export type PifferoInput =
    | Readable
    | ReadableStream<Uint8Array | string>
    | string
    | Buffer
    | Uint8Array
    | Record<string, any>
    | any[];
  ```
- Aggiornare `Piffero.findByPath`, `Piffero.findAsString` e `Piffero.findAsPromise` per accettare qualsiasi `PifferoInput`:
  - **Node.js `Readable`**: flusso invariato.
  - **WHATWG `ReadableStream`** (rilevato tramite `typeof (input as any)?.getReader === "function"`): convertito internamente in `Readable` tramite `Readable.fromWeb()` (con propagazione dell'abort/cancel sull'early-exit).
  - **`string` / `Buffer` / `Uint8Array`**: alimentato direttamente in `CStream` / `CParser` (o `Readable.from`) evitando conversioni superflue.
  - **Oggetto o Array JS già in memoria**: valutato direttamente con `tokenizeJsonPath()` + `evaluateStepsOnValue()` (già presente in `src/handler/jsonpathEngine.ts`) senza serializzare l'oggetto in JSON per poi ri-parsarlo con `CStream`.
- Introdurre il metodo sincrono `Piffero.query(input: Record<string, any> | any[] | string | Buffer, jsonPath?: string, options?: PifferoQueryOptions): any[]` che restituisce direttamente l'array JS dei valori (o percorsi) matchati, offrendo un'alternativa drop-in sincrona a `JSONPath({ json, path })` di `jsonpath-plus`.

## Performance Focus
- **Zero serializzazione per oggetti JS in-memory**: quando l'input è un oggetto o array JS, usare direttamente `evaluateStepsOnValue(input, steps, 0, input)` e la cache AST di `ConditionEval`, ottenendo valutazione in-memory pura con semantica RFC 9535.
- **Fast-feed per `string` e `Buffer`**: in `findAsString` / `findAsPromise` / `query` su `Buffer` o `string`, inviare il buffer direttamente a `CParser.writeBuffer()` evitando l'overhead di creazione della coda `Readable` di Node.js.
- **Early termination su Web `ReadableStream`**: assicurarsi che quando `rootMaxIndex` interrompe lo stream anticipatamente, il `Readable` generato da `Readable.fromWeb()` cancelli (`cancel()`) correttamente lo stream Web sottostante (es. chiudendo il download HTTP di `fetch()`).

## Impact
- **Affected code**: `src/piffero.ts`, `src/handler/mastehandler.ts`, `src/handler/jsonpathEngine.ts`, `index.ts`, `spec/piffero/`
- **Breaking changes**: Nessuno (100% retrocompatibile con chi passa un Node.js `Readable`).
