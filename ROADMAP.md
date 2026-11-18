# piffero-plus Roadmap

Questo documento definisce la roadmap evolutiva di **piffero-plus** (continuazione di `piffero`), il parser JSON SAX-like basato su stream con supporto JSONPath.

---

## Stato attuale (`piffero-plus@1.0.0`, Fasi 1–5 completate)
- Parsing incrementale via `CStream` (porting TypeScript di Clarinet con `StringDecoder` e `skipDecode`) e motore `StreamingPathEngine`.
- API pubblica: `Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`, `Piffero.query`.
- Input universale (`PifferoInput`): Node.js `Readable`, WHATWG Web `ReadableStream` (`fetch().body`), `string` / `Buffer` / `Uint8Array`, e oggetti/array JS in-memory.
- Conformità completa RFC 9535: `$`, `@`, `.`, `..`, `*`, `[index]`, `[start:end:step]`, unioni eterogenee ordinate `[,]`, filtri `?` / `?()` con semantica `NOTHING`, sub-query e riferimenti `$`, funzioni standard (`length`, `count`, `match`, `search`, `value`), espressioni script `()`, e modalità di output `resultType` (`"value" | "path" | "pointer" | "all"` con Normalized Paths §2.7 e JSON Pointer RFC 6901).
- Interruzione anticipata automatica dello stream (`rootMaxIndex`) per query deterministiche.

---

## Fase 1 — Ottimizzazione Core & Affidabilità (v1.2.0)
Focus su prestazioni su file di grandi dimensioni, riduzione allocazioni e gestione corretta degli stream Node.js.

- [x] **#1 — Eliminare il doppio parsing ricorsivo nei JSONPath con condizioni**
  Evitare la creazione di un secondo `MasterHandler` + `CStream` quando una condizione è seguita da ulteriori segmenti di percorso.
- [x] **#2 — Sostituire concatenazioni di stringhe (`+=`) e `push()` per singolo token**
  Introdurre bufferizzazione basata su array (`string[]` + `join`) e chunking minimo configurabile prima di `stream.push()`.
- [x] **#3 — Calcolo O(1) per slice/unioni in `buildParsedPath`**
  Eliminare la materializzazione dell'array `indexes` per i range `[start:end:step]` e usare `Set<number>` per le unioni esplicite.
- [x] **#4 — Gestione backpressure e `StringDecoder` nativo in `CStream`**
  Rispettare il valore di ritorno di `output.push()` con `pause()`/`resume()` sullo stream sorgente e sostituire il decoder UTF-8 manuale con `string_decoder`.
- [x] **#5 — Pulizia dipendenze e propagazione errori su stream**
  Rimuovere `underscore` (inutilizzato), alleggerire `ConditionEval` (riducendo la dipendenza da `esprima`/`static-eval`) e propagare gli errori tramite `output.destroy(err)` in modalità stream.

---

## Fase 2 — Completamento Sintassi JSONPath (v1.3.0)
Allineamento alle specifiche JSONPath complete descritte nel `README.md` (OpenSpec `complete-jsonpath-syntax`):

- [x] **#8 — Wildcard `*`** (es. `$.employees[*].name`, `$.*`).
- [x] **#9 — Recursive descent `..`** (es. `$..phoneNumbers`, `$.employees..type`).
- [x] **#10 — Filtri completi `?()`**: supporto a operatori di confronto (`!=`, `!==`, `==`, `>`, `<`, `>=`, `<=`), operatori logici (`&&`, `||`, `!`) e verifica di esistenza proprietà.
- [x] **#11 — Operatore elemento corrente `@`**: riferimento diretto su primitivi (`[?(@ > 10)]`) e proprietà annidate (`@.address.city`).
- [x] **#12 — Script expression `()`**: valutazione espressioni subscript (es. `[(1+1)]`, `[(@.length-1)]`).

---

## Fase 3 — Modernizzazione, DX & CI (v1.4.0)
- [ ] Migrazione da `tslint` (deprecato) a `eslint` + `@typescript-eslint`.
- [ ] Supporto dual-package ESM / CommonJS e aggiornamento target TypeScript / `@types/node`.
- [x] Migrazione CI da Travis CI (`.travis.yml`) a GitHub Actions (`.github/workflows/ci.yml`).
- [x] Aggiornamento del `README.md` per allineare la tabella delle feature effettivamente supportate.

---

## Fase 4 — Conformità completa JSONPath RFC 9535 (Performance-First)
Allineamento integrale allo standard [RFC 9535](https://www.rfc-editor.org/info/rfc9535/) preservando zero-dependency, streaming a RAM limitata, `skipDecode`, `PrunedJsBuilder` e fast-path O(1) su dataset da 200+ MiB.

Ordine di implementazione consigliato (per dipendenze e impatto):

1. [x] **#20 — Filtri senza parentesi tonde `?[...]`** ([OpenSpec](./openspec/changes/rfc9535-filter-parentheses/proposal.md))
   - Normalizzazione a compile-time in `parseBracketSubscript` con zero overhead runtime e hit rate invariato su `astCache`.
2. [x] **#23 — Semantica Slice RFC 9535 (`step < 0`, `step === 0`, `end === 0`)** ([OpenSpec](./openspec/changes/rfc9535-slice-semantics/proposal.md))
   - Algoritmo `Bounds` ufficiale, correzione di `end === 0`, fast-path O(1) preservato per `step > 0` e ring-buffer O(`k`) per tail reverse slice.
3. [x] **#25 — Escape Unicode (`\uXXXX`, surrogate) e validazione I-JSON / `member-name-shorthand`** ([OpenSpec](./openspec/changes/rfc9535-lexical-escapes-validation/proposal.md))
   - Fast-path `indexOf("\\") === -1` e validazione esclusivamente a compile-time.
4. [x] **#24 — Semantica esistenza, confronti e `Nothing` nei filtri** ([OpenSpec](./openspec/changes/rfc9535-filter-semantics-nothing/proposal.md))
   - Sentinella singleton `NOTHING` a zero allocazioni, equality strutturale con fast-path primitivo e preservazione dell'early-skip di `PrunedJsBuilder`.
5. [x] **#22 — Unioni eterogenee nei bracket e ordine/duplicati dei selettori** ([OpenSpec](./openspec/changes/rfc9535-heterogeneous-unions/proposal.md))
   - Step `union` ordinato con fast-path invariato per unioni omogenee semplici.
6. [x] **#21 — Query JSONPath complete nei filtri (`@`, `$`) e proiezione root** ([OpenSpec](./openspec/changes/rfc9535-filter-full-queries-root/proposal.md))
   - Compilazione una-tantum delle sub-query e `rootProjection` potata in `StreamingPathEngine` per evitare il caricamento dell'intera root in RAM quando si usa `$...`.
7. [x] **#19 — Funzioni standard RFC 9535 (`length`, `count`, `match`, `search`, `value`)** ([OpenSpec](./openspec/changes/rfc9535-standard-functions/proposal.md))
   - Precompilazione I-Regexp a compile-time per `match`/`search`, fast-path ASCII O(1) per `length()` e tracciamento argomenti in `PrunedJsBuilder`.

---

## Fase 5 — Output Estesi RFC 9535 & Input Universale (Oltre `jsonpath-plus`)
Estensione dell'API per coprire gli ultimi scenari d'uso in cui gli sviluppatori ricorrono a `jsonpath-plus`, mantenendo zero dipendenze, memoria `O(depth)` in streaming e zero regressioni sui fast-path esistenti.

1. [x] **Normalized Paths RFC 9535 (§2.7) e Modalità di Output (`resultType`)** ([OpenSpec](./openspec/changes/rfc9535-normalized-paths-result-type/proposal.md))
   - **Obiettivo**: Permettere a `piffero-plus` di restituire non solo i valori estratti (`value`, default), ma anche i **Normalized Paths** definiti da [RFC 9535 §2.7](https://www.rfc-editor.org/rfc/rfc9535#section-2.7) (es. `$['employees'][0]['phoneNumbers'][1]['number']`), i **JSON Pointer** (RFC 6901, es. `/employees/0/phoneNumbers/1/number`), oppure oggetti combinati `{ path, pointer, value }` (`resultType: 'value' | 'path' | 'pointer' | 'all'`).
   - **Perché ha senso**:
     - Completa la conformità alla sezione 2.7 di RFC 9535 (che standardizza la forma canonica dei percorsi con singoli apici `['...']`, escape minimi `\b \f \n \r \t \' \\ \u00XX` e indici interi non negativi `[i]`).
     - Consente casi d'uso di auditing, indicizzazione di file JSON giganti, localizzazione precisa dei match e migrazione immediata da `jsonpath-plus` (`resultType`).
   - **Design & Vincoli di Performance**:
     - **Zero overhead quando `resultType === 'value'` (default)**: nessuna concatenazione di stringhe di path deve avvenire se non richiesta dalle opzioni.
     - **Memoria `O(depth)` in streaming**: `StreamingPathEngine` mantiene già lo stack dei frame (`frameStack`) con la chiave corrente (per gli oggetti) o `elementIndex` (per gli array). Il Normalized Path va formattato **lazy** solo nell'istante in cui un nodo fa match (o viene catturato in un `PendingSlot`), evitando allocazioni sui rami scartati.
     - **Compatibilità early-exit & `skipDecode`**: quando `resultType` è `'path'` o `'pointer'` su un match che non richiede l'estrazione del sottoalbero del valore (es. un oggetto o array matchato), il motore può emettere subito il percorso normalizzato e saltare la serializzazione del valore con `skipDecode`.

2. [x] **Input Universale (Node `Readable`, Web `ReadableStream`, `string` / `Buffer` e Oggetti JS in-memory)** ([OpenSpec](./openspec/changes/universal-input-sources/proposal.md))
   - **Obiettivo**: Permettere a `piffero-plus` di interrogare con la stessa API e la stessa semantica RFC 9535 qualsiasi sorgente dati:
     1. **Node.js `Readable`** (file stream, socket, `zlib`, pipeline Node).
     2. **WHATWG Web `ReadableStream`** (es. `fetch(url).then(res => res.body)` nativo in Node 18–24, Deno, Bun ed Edge runtime), convertito internamente tramite `webStreamToNodeReadable` con supporto `reader.cancel()` su early-exit.
     3. **`string` / `Buffer` / `Uint8Array`** (payload JSON già in memoria ma non ancora deserializzati, processabili via `MasterHandler.parseSync` senza passare per l'overhead degli eventi di `Readable` o `JSON.parse()` completo).
     4. **Oggetti / Array JavaScript già parsati in memoria** (valutati direttamente tramite `evaluateInMemory()` in [`src/handler/jsonpathEngine.ts`](./src/handler/jsonpathEngine.ts)).
   - **Perché ha senso**:
     - Elimina la necessità di installare due librerie diverse (`piffero-plus` per gli stream grandi e `jsonpath-plus` per gli oggetti in RAM o le risposte `fetch()`).
     - Sulle risposte HTTP streaming (`fetch`), poter passare direttamente `response.body` riduce il codice utente a una sola riga.
     - Sugli oggetti JS già in memoria, il riutilizzo diretto di `tokenizeJsonPath()` + `evaluateInMemory()` (con cache AST in `ConditionEval`) evita qualsiasi serializzazione intermedia e offre tutte le garanzie RFC 9535 di `piffero-plus` (`NOTHING`, filtri senza parentesi, funzioni standard, unioni ordinate) risultando ~3.0x–3.6x più veloce di `jsonpath-plus`.
   - **Design & API implementata**:
     - Estesi gli input accettati da `findByPath`, `findAsString`, `findAsPromise` (`PifferoInput`) e introdotto il metodo sincrono `Piffero.query(input, jsonPath?, options?)` per oggetti JS e buffer/stringhe in-memory, mantenendo il 100% di retrocompatibilità con le firme esistenti.


