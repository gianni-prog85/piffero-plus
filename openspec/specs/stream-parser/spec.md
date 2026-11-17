# Spec: Stream Parser & JSONPath Engine

## Purpose
Definisce il comportamento garantito del motore di parsing streaming e del matcher JSONPath di `piffero-plus`.

## Requirements

### Requirement: Streaming JSON Extraction
Il sistema DEVE poter processare uno stream `Readable` di input senza caricare l'intero documento JSON in memoria e restituire un array JSON valido contenente i soli valori corrispondenti al `jsonPath`.

#### Scenario: Estrazione di una proprietà semplice via Stream
- **GIVEN** uno stream JSON valido (es. `john-doe.json`)
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.firstName")`
- **THEN** lo stream risultante emette `["John"]` ed è parsabile con `JSON.parse`.

#### Scenario: Estrazione asincrona via Promise
- **GIVEN** uno stream JSON valido
- **WHEN** viene invocato `Piffero.findAsPromise(stream, "$.firstName")`
- **THEN** la Promise si risolve con la stringa JSON `'["John"]'`.

### Requirement: Early Stream Termination
Quando il `jsonPath` identifica un singolo elemento non-bulk (es. `$.firstName` o `$.employees[1]`), il sistema DEVE interrompere la lettura dello stream sorgente appena l'elemento è stato completamente estratto.

#### Scenario: Match all'inizio di un file di grandi dimensioni
- **GIVEN** un file JSON di grandi dimensioni con il target nei primi byte
- **WHEN** il match è completato (`status.end && isLast`)
- **THEN** `CStream` e lo stream di input vengono disconnessi e distrutti senza leggere il resto del file.

### Requirement: Array Indexing, Slicing e Unions
Il parser DEVE supportare indici singoli (`[n]`), unioni (`[a,b,c]`) e slice (`[start:end:step]`) sia su array di oggetti che su array di primitivi.

#### Scenario: Filtro condizionale su array di oggetti
- **GIVEN** un array JSON contenente oggetti
- **WHEN** viene invocato `Piffero.findByPath(stream, "$.array[?(@.a===2)].type")`
- **THEN** vengono restituiti i valori della proprietà `type` dei soli oggetti che soddisfano la condizione.

### Requirement: Error Handling
In caso di JSONPath non valido (non inizia con `$` o sintassi parentesi errata), `parse()` DEVE lanciare `PifferoJsonPathError`. In caso di JSON malformato, l'errore DEVE essere propagato come `PifferoError`.
