# Project Context: piffero-plus

## Purpose
`piffero-plus` è una libreria TypeScript/Node.js per il parsing streaming di file JSON di grandi dimensioni (anche superiori alla RAM disponibile) tramite espressioni JSONPath, con approccio SAX-like a eventi.

## Tech Stack
- **Language**: TypeScript (`tsconfig.json`) compilato in `./dist` (zero dipendenze runtime)
- **Runtime**: Node.js (`stream`, `string_decoder`) e compatibilità Web `ReadableStream`
- **SAX Engine**: `CStream` (`src/libs/clarinet/cstream.ts`), adattamento TypeScript di Clarinet con `StringDecoder` e `skipDecode`
- **Expression Eval**: `ConditionEval` (`src/conditioneval/conditioneval.ts`), parser/valutatore AST embedded zero-dependency conforme a RFC 9535 (sentinella `NOTHING`, funzioni standard, I-Regexp RFC 9485)
- **Testing**: Jasmine + `jasmine-ts` (`spec/`), coverage con `nyc`
- **Benchmarking**: Suite su 200 MiB (`benchmarking/`) vs `@sapientpro/json-stream`, `json-web-streams`, `stream-json`, `@streamparser/json`, `oboe.js`, `bfj`, `jsonpath-plus`

## Architecture
- `src/piffero.ts`: Facciata pubblica (`Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`, `Piffero.query`) con supporto a `PifferoInput` (Node `Readable`, Web `ReadableStream`, `string`/`Buffer`/`Uint8Array`, oggetti/array JS) e `PifferoQueryOptions` (`resultType: "value" | "path" | "pointer" | "all"`).
- `src/handler/mastehandler.ts`:
  - `parse()` / `buildParsedPath()`: compilatore JSONPath (`PifferoJsonPathError` sincrono su sintassi non valida).
  - `MasterHandler`: orchestra `SingleStepHandler` (fast-path per percorsi lineari semplici) e `StreamingPathEngine`, incluso il fast-path sincrono `parseSync` per `string`/`Buffer`/`Uint8Array`.
- `src/handler/jsonpathEngine.ts`:
  - `StreamingPathEngine`: motore streaming completo per wildcard, `..`, slice RFC 9535, unioni eterogenee ordinate (`PendingSlot`), script, filtri con `PrunedJsBuilder`, `rootProjection` per riferimenti `$` e formattazione lazy di Normalized Paths (§2.7) e JSON Pointer (RFC 6901).
  - `evaluateInMemory()` / `evaluateStepsOnValue()`: valutazione diretta su oggetti/array JS in memoria.
- `src/conditioneval/conditioneval.ts`: compilazione con cache AST e valutazione di filtri ed espressioni script.
- `src/libs/clarinet/cstream.ts`: parser JSON a stati che trasforma chunk o stream in eventi SAX.

## Conventions
- L'output prodotto da `findByPath`, `findAsString` e `findAsPromise` è sempre un array JSON valido (`[...]`), mentre `Piffero.query()` restituisce direttamente l'array JS dei risultati (`any[]`).
- I test devono verificare che l'output sia JSON valido (`JSON.parse`) e corrispondente ai risultati attesi in `spec/piffero/`.
- Per query deterministiche (`rootMaxIndex`), lo stream sorgente (Node `Readable` o Web `ReadableStream`) viene terminato/cancellato non appena il match è completato.
