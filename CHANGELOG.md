# Changelog

All notable changes to `piffero-plus` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-21

### Added
- **Async Iterator API (`Piffero.iterate()`)**:
  - Added `Piffero.iterate<T>(input, jsonPath?, options?)` returning an `AsyncIterableIterator` for `for await...of` streaming consumption across all `PifferoInput` sources (Node.js `Readable`, Web `ReadableStream`, `string`/`Buffer`/`Uint8Array`, and in-memory JS objects/arrays).
  - Supports automatic backpressure and immediate upstream stream cancellation on early `break`/`return`.
  - Added zero-dependency streaming `JsonArrayItemSplitter` (`src/utils/jsonArraySplitter.ts`) for incremental JSON array item splitting.
- **TypeScript Generics & Typed Overloads**:
  - Added generic `<T = any>` type parameters and `resultType`-aware overloads to `Piffero.query<T>()`, `Piffero.findAsPromise<T>()`, and `Piffero.iterate<T>()`.
  - Exported `PifferoAllResult<T>` (`{ path: string; pointer: string; value: T }`) from the package root.
- **CLI Enhancements (`--ndjson`, `--raw`, `.gz` / `--gzip`)**:
  - Added `--ndjson` / `--jsonl` to stream one compact JSON value per line with O(1) memory.
  - Added `-R` / `--raw` / `--raw-output` to stream unquoted string values line-by-line (like `jq -r`).
  - Added `-z` / `--gzip` for streaming gzip decompression (auto-enabled for `.gz` files) with automatic source cleanup on early termination.

### Changed
- **Tooling & Dev Dependencies**:
  - Migrated linting from deprecated `tslint` to `eslint` v10 + `typescript-eslint` v8 (`eslint.config.mjs`).
  - Updated `devDependencies` (`typescript` 5.9, `jasmine` 6.3, `prettier` 3.10, `nyc` 18, `@types/node` 22, `express` 5.3).

## [1.1.0] - 2026-11-18

### Added
- **Normalized Paths (RFC 9535 §2.7), JSON Pointer (RFC 6901) & `resultType` (`PifferoQueryOptions`)**:
  - Added optional `options?: PifferoQueryOptions` (`resultType: "value" | "path" | "pointer" | "all"`) to `Piffero.findByPath`, `Piffero.findAsString`, `Piffero.findAsPromise`, and `Piffero.query`.
  - Canonical RFC 9535 §2.7 Normalized Path formatting (`$['employees'][0]['name']`, single-quote escaping `\b`, `\f`, `\n`, `\r`, `\t`, `\'`, `\\`, `\u00XX`) and RFC 6901 JSON Pointer formatting (`/employees/0/name`, `~0`, `~1`).
  - Lazy `O(depth)` path segment tracking in `StreamingPathEngine` with zero overhead when `resultType === "value"` (default) and `skipDecode` container fast-skip when `resultType` is `"path"` or `"pointer"`.
- **Universal Input Sources (`PifferoInput`) & `Piffero.query()`**:
  - Extended `findByPath`, `findAsString`, and `findAsPromise` to accept Node.js `Readable` streams, WHATWG Web `ReadableStream` (`fetch().body`, with backpressure and `reader.cancel()` on early stream termination), raw `string` / `Buffer` / `Uint8Array` (via synchronous `MasterHandler.parseSync` fast-path), and in-memory JS objects/arrays (`evaluateInMemory`).
  - Added synchronous `Piffero.query(input, jsonPath?, options?)` returning `any[]` directly for in-memory JS objects/arrays, `string`, `Buffer`, and `Uint8Array`.
  - Exported `PifferoInput`, `WebReadableStreamLike`, `PifferoResultType`, and `PifferoQueryOptions` from package root.
- **Streaming CLI (`npx piffero-plus` / `piffero`)**:
  - Added `bin/piffero-plus.js` (`src/cli.ts`) supporting file and `stdin` streaming, `--path`, `--pointer`, `--all`, `-r, --result-type <type>`, and `-p, --pretty`.
- **Dual ESM / CommonJS Package Exports**:
  - Added `esm/index.mjs` and `package.json` `exports` map (`import` + `require` + `types`) with `"sideEffects": false`.
- **Phase 5 Benchmark Suite (`npm run benchmark:phase5`)**:
  - Added `benchmarking/compare-phase5.js` comparing pure in-memory `Piffero.query()` vs `jsonpath-plus`, `resultType: "path"` on 200 MiB JSON, RFC 9535 standard functions on 200 MiB JSON, and Web `ReadableStream` on 200 MiB JSON.

## [1.0.0] - 2026-11-17

First public release of `piffero-plus` (evolved from `piffero`), a zero-dependency streaming SAX-like JSONPath parser for Node.js with full RFC 9535 compliance.

### Added
- **Streaming JSONPath Engine (`StreamingPathEngine`)**:
  - Wildcards (`*`, `[*]`) and depth-first pre-order recursive descent (`..`).
  - Complete RFC 9535 array slicing (`[start:end:step]`, negative bounds/step, `step = 0`) with O(1) forward streaming and O(*k*) ring-buffered tail slices.
  - Homogeneous and heterogeneous bracket unions (`[,]`) preserving exact selector order and duplicates (`$[2, 0, 2]`, `$[0, 2:4, *]`, `$['b', 'a', 'b']`).
  - Script expressions (`(1+1)`, `(@.length-1)`, `($.idx)`).
- **Full RFC 9535 Filter Support (`ConditionEval`)**:
  - Both parenless (`?[...]`) and parenthesized (`?(...)`) filter expressions.
  - Singleton `NOTHING` semantics, falsy-safe existence tests (`false`, `0`, `""`, `null`), non-coercing structural `==`/`!=`, and type-safe `<`/`<=`/`>`/`>=`.
  - Full sub-queries inside filters (`@..price`, `@.tags[*]`, nested filters) and root `$` references with pruned `rootProjection` and deferred candidate evaluation.
  - Standard RFC 9535 functions (`length()`, `count()`, `value()`, `match()`, `search()`) with compile-time type checking and cached RFC 9485 I-Regexp compilation.
  - Compile-time `\uXXXX` / UTF-16 surrogate pair decoding, `member-name-shorthand` validation, and I-JSON safe integer bounds.
- **Performance & Memory Optimizations**:
  - `skipDecode` in `CStream` to bypass UTF-8 decoding on skipped branches.
  - `PrunedJsBuilder` static field projection for filter candidates.
  - `rootMaxIndex` automatic early stream termination on deterministic queries.
  - Backpressure-aware `Readable` output (`findByPath`), 16 KiB buffered string callback (`findAsString`), and Promise API (`findAsPromise`).
- **Public Error Exports**:
  - Exported `PifferoError` and `PifferoJsonPathError` alongside `Piffero` from the package entry point.
- **Documentation & CI**:
  - Added `README.md`, `docs/api-reference.md`, `docs/jsonpath-guide.md`, `docs/architecture.md`, `docs/advantages.md`, and 200 MiB benchmark reports.
  - Added GitHub Actions CI workflow (`.github/workflows/ci.yml`) for Node.js 22 and 24.

### Removed
- Removed legacy `.travis.yml` configuration in favor of GitHub Actions.
