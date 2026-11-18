# Proposal: Normalized Paths RFC 9535 (§2.7) e Modalità di Output (`resultType`)

- **Spec RFC 9535**: §2.7 (Normalized Paths), RFC 6901 (JSON Pointer)

## Why
Lo standard RFC 9535 §2.7 definisce formalmente il **Normalized Path** per ogni nodo selezionato da una query JSONPath (es. `$['employees'][0]['phoneNumbers'][1]['number']`). Inoltre, uno dei motivi principali per cui gli sviluppatori ricorrono ancora a `jsonpath-plus` è l'opzione `resultType` (`'value' | 'path' | 'pointer' | 'all'`), utile per localizzare dove si trovano i dati estratti, costruire indici o fare auditing su file JSON di grandi dimensioni.
Attualmente `piffero-plus` emette esclusivamente i valori estratti (`value`).

## What Changes
- Introdurre un tipo di opzioni `PifferoQueryOptions`:
  ```ts
  export type PifferoResultType = "value" | "path" | "pointer" | "all";
  export interface PifferoQueryOptions {
    resultType?: PifferoResultType;
  }
  ```
- Estendere `Piffero.findByPath`, `Piffero.findAsString` e `Piffero.findAsPromise` con il parametro opzionale `options?: PifferoQueryOptions` (default `{ resultType: "value" }`).
- Implementare il formattatore canonico di **Normalized Path** secondo RFC 9535 §2.7:
  - Selettori di nome sempre tra singoli apici `$['key']`.
  - Escape canonico dei caratteri speciali (`\b`, `\f`, `\n`, `\r`, `\t`, `\'`, `\\`, e `\u00XX` minuscolo esadecimale per gli altri caratteri di controllo `U+0000..U+001F`).
  - Selettori di indice array sempre come interi decimali non negativi `$[0]`.
- Implementare il formattatore **JSON Pointer** secondo RFC 6901 (`/employees/0/phoneNumbers/1/number`, con escape `~0` per `~` e `~1` per `/`).
- Supportare `resultType: "all"`, che emette per ciascun match un oggetto JSON `{"path":"$['a'][0]","pointer":"/a/0","value":...}`.
- Aggiornare anche `evaluateStepsOnValue` per propagare il percorso relativo durante la valutazione in-memory (post-filter, post-script, array collector).

## Performance Focus
- **Zero overhead sul default (`resultType === "value"`)**: quando `options?.resultType` è omesso o `"value"`, non deve essere allocato né mantenuto alcuno stato aggiuntivo o stringa di percorso durante la scansione SAX.
- **Tracciamento `O(depth)` e formattazione lazy**: `StreamingPathEngine` mantiene già lo stack dei frame (`frameStack`) con `elementIndex` per gli array e può conservare la chiave corrente `currentKey` per ogni frame oggetto. La stringa del Normalized Path o del JSON Pointer deve essere costruita **solo nel momento in cui un nodo fa effettivamente match**, evitando concatenazioni sui rami non selezionati.
- **Fast-skip (`skipDecode`) per `resultType: "path" | "pointer"`**: quando un nodo container (oggetto o array) fa match su l'ultimo step della query e l'utente ha richiesto solo `"path"` o `"pointer"`, il motore può emettere immediatamente il percorso normalizzato senza raccogliere i token del sottoalbero con `JsonValueCollector`, lasciando attivo `skipDecode` sull'intero valore.

## Impact
- **Affected code**: `src/piffero.ts`, `src/handler/mastehandler.ts`, `src/handler/jsonpathEngine.ts`, `index.ts`, `spec/piffero/`
- **Breaking changes**: Nessuno (parametro `options` opzionale con default `"value"`).
