# Changelog

All notable changes to `piffero-plus` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
