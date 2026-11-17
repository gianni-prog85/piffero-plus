# Project Context: piffero-plus

## Purpose
`piffero-plus` è una libreria TypeScript/Node.js per il parsing streaming di file JSON di grandi dimensioni (anche superiori alla RAM disponibile) tramite espressioni JSONPath, con approccio SAX-like a eventi.

## Tech Stack
- **Language**: TypeScript (`tsconfig.json`) compilato in `./dist`
- **Runtime**: Node.js (`stream`)
- **SAX Engine**: `CStream` (`src/libs/clarinet/cstream.ts`), adattamento TypeScript di Clarinet
- **Expression Eval**: `esprima` + `static-eval` (`src/conditioneval/conditioneval.ts`)
- **Testing**: Jasmine + `jasmine-ts` (`spec/`), coverage con `nyc`
- **Benchmarking**: `benchmark` vs `oboe.js` (`benchmarking/`)

## Architecture
- `src/piffero.ts`: Facciata pubblica (`Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`).
- `src/handler/mastehandler.ts`:
  - `parse()` / `buildParsedPath()`: parser JSONPath che produce una lista concatenata `ParsedPath`.
  - `MasterHandler`: orchestra la pipeline di `SingleStepHandler` e riceve gli eventi da `CStream`.
  - `SingleStepHandler` + `PifferoStatus`: macchina a stati per il matching e la registrazione di ogni segmento del path.
- `src/conditioneval/conditioneval.ts`: valutazione di espressioni statiche nei filtri.
- `src/libs/clarinet/cstream.ts`: parser JSON a stati che trasforma un `Writable` stream in eventi SAX.

## Conventions
- L'output prodotto da `piffero-plus` è sempre un array JSON valido (`[...]`), sia in modalità stream che stringa/Promise.
- I test devono verificare che l'output sia JSON valido (`JSON.parse`) e corrispondente ai risultati attesi in `spec/piffero/`.
- Per query non-bulk (singolo elemento/percorso deterministico), lo stream sorgente viene distrutto non appena il match è completato (`checkStreams()`).
