# Tasks: Normalized Paths RFC 9535 (§2.7) e Modalità di Output (`resultType`)

- [ ] Definire ed esportare `PifferoResultType` (`"value" | "path" | "pointer" | "all"`) e `PifferoQueryOptions` in `src/piffero.ts` e `index.ts`.
- [ ] Implementare le funzioni pure `formatNormalizedPath(segments: Array<string | number>): string` (conforme alle regole di escape canonico RFC 9535 §2.7) e `formatJsonPointer(segments: Array<string | number>): string` (RFC 6901).
- [ ] Tracciare `currentKey` nei frame `object` di `StreamingPathEngine` (`src/handler/jsonpathEngine.ts`) con costo O(1) e costruire lo snapshot del path solo all'attivazione di un match (`PendingSlot` / `ActiveCapture` / `ActiveFilter` / `ActiveArrayCollector`).
- [ ] Estendere `evaluateStepsOnValue` (`src/handler/jsonpathEngine.ts`) per tracciare i segmenti di percorso relativi nei passi valutati in-memory (post-filter, post-script, tail slice) quando `resultType !== "value"`.
- [ ] Ottimizzare il caso `resultType === "path" | "pointer"` in `StreamingPathEngine` per emettere subito il percorso sul match finale senza istanziare `JsonValueCollector` sul sottoalbero del valore (preservando `skipDecode`).
- [ ] Supportare `options?: PifferoQueryOptions` anche nel fast-path `SingleStepHandler` (`src/handler/mastehandler.ts`) o instradare su `StreamingPathEngine` quando `resultType !== "value"`.
- [ ] Aggiungere unit test in `spec/piffero/` per verificare `resultType: "path"`, `"pointer"` e `"all"` (inclusi caratteri speciali/controllo RFC 9535 §2.7, slice negativi, unioni eterogenee, recursive descent `..` e filtri) e confrontare la parità con `jsonpath-plus`.
- [ ] Verificare con i benchmark su 200 MiB che `resultType: "value"` (default) non introduca alcuna regressione di throughput o memoria.
