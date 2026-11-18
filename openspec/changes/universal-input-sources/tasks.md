# Tasks: Input Universale (Node `Readable`, Web `ReadableStream`, `string`/`Buffer` e Oggetti JS)

- [ ] Definire ed esportare il tipo `PifferoInput` in `src/piffero.ts` e `index.ts`.
- [ ] Creare un normalizzatore di input in `src/piffero.ts` / `src/handler/mastehandler.ts` che distingua:
  - Node.js `Readable` (`typeof (input as any)?.pipe === "function"`),
  - WHATWG `ReadableStream` (`typeof (input as any)?.getReader === "function"` → `Readable.fromWeb`),
  - `Buffer` / `Uint8Array` / `string`,
  - Oggetti o Array JS in-memory (`typeof input === "object" && input !== null`).
- [ ] Implementare il fast-path sincrono per `string` / `Buffer` / `Uint8Array` che alimenta direttamente `CStream` / `CParser` senza istanziare uno stream `Readable` intermedio quando invocato da `findAsString`, `findAsPromise` o `query`.
- [ ] Implementare la valutazione diretta in-memory tramite `tokenizeJsonPath(jsonPath)` + `evaluateStepsOnValue(obj, steps, 0, obj)` quando l'input è un oggetto/array JS già parsato.
- [ ] Aggiungere il metodo sincrono `Piffero.query(input, jsonPath = "$", options?)` che restituisce direttamente `any[]` (valori JS deserializzati o Normalized Paths) per oggetti in-memory, `string` e `Buffer`.
- [ ] Verificare che l'early-exit (`rootMaxIndex`) su un `ReadableStream` Web cancelli lo stream sorgente senza leggere i chunk residui.
- [ ] Aggiungere unit test completi in `spec/piffero/` per ciascun tipo di input (`Readable`, Web `ReadableStream`, `string`, `Buffer`, `Uint8Array`, oggetto JS, array JS) e per `Piffero.query()`.
- [ ] Aggiornare `README.md` e `docs/api-reference.md` con esempi per `fetch()` (`res.body`) e `Piffero.query()`.
