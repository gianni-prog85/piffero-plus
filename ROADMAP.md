# piffero-plus Roadmap

Questo documento definisce la roadmap evolutiva di **piffero-plus** (continuazione di `piffero`), il parser JSON SAX-like basato su stream con supporto JSONPath.

---

## Stato attuale (pubblicato come `piffero-plus@1.0.0`, base `v1.1.13`)
- Parsing incrementale via `CStream` (porting TypeScript di Clarinet).
- API pubblica: `Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`.
- Supporto JSONPath base: `$`, `.`, `[index]`, `[i,j]`, `[start:end:step]`, filtri di uguaglianza semplici `[?(@.prop===val)]`.
- Interruzione anticipata dello stream per query non-bulk.

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
- [ ] Migrazione CI da Travis CI (`.travis.yml`) a GitHub Actions (test, coverage, benchmark regression check).
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

