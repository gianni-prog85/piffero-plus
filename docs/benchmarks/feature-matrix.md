# Feature & JSONPath Compatibility Matrix

Side-by-side comparison across all 8 tested libraries (`piffero-plus`, `@sapientpro/json-stream`, `stream-json`, `json-web-streams`, `@streamparser/json`, `Oboe`, `bfj`, and `jsonpath-plus`).

| Capability | `piffero-plus` | `@sapientpro/json-stream` | `stream-json` | `json-web-streams` | `@streamparser/json` | Oboe | `bfj` | `jsonpath-plus` |
|---|---|---|---|---|---|---|---|---|
| **Streaming (larger than RAM)** | ✅ | ✅ | ✅ | ✅ (Web Streams) | ✅ | ✅ | ✅ | ❌ (full `JSON.parse` in RAM) |
| **Zero runtime dependencies** | ✅ | ✅ | ❌ (`stream-chain`) | ❌ (`jsonpath-rfc9535`, `@standard-schema/spec`) | ✅ | ✅ | ❌ | ❌ |
| **Native Node.js `Readable` output + backpressure** | ✅ (`findByPath`) | ❌ (Writable / callbacks) | ✅ (pipeline) | ❌ (`TransformStream`) | ❌ (`@streamparser/json-node`) | ❌ (callback events) | ✅ (object mode, drops `null`) | ❌ |
| **Direct JSON stream pass-through (no JS alloc for skipped branches)** | ✅ | ❌ (JS objects) | Optional (`pick` + `stringer`) | ❌ (JS objects) | ❌ (JS objects) | ❌ (JS objects) | ❌ (JS objects) | ❌ |
| **Automatic early stream termination** | ✅ | Manual (`destroy()`) | Manual (`once` + `destroy()`) | Manual (`cancel()`) | Manual (`destroy()`) | Manual (`this.abort()`) | Manual (`destroy()`) | ❌ |
| **Child keys (`$.a.b`)** | ✅ | ✅ | Manual (`pick`) | ✅ | ✅ | ✅ | Broken on `$.` array paths | ✅ |
| **Array index (`$[1]`)** | ✅ | ✅ | Manual (`pick`) | ❌ (throws) | ✅ | ✅ | ❌ | ✅ |
| **Wildcard (`*`)** | ✅ | ✅ | Via RegExp | ✅ | ✅ | ✅ | Predicate fn only | ✅ |
| **Recursive descent (`..`)** | ✅ | ✅ | Via RegExp | ❌ (throws) | ❌ (throws) | ✅ | Key-only (`'prop'`) | ✅ |
| **Array slices (`[start:end:step]`, negative/zero step, unions)** | ✅ (RFC 9535) | ❌ (throws) | ❌ | ❌ (`Unsupported node: SliceSelector`) | ❌ (throws) | Partial (no slices) | ❌ | ✅ (RFC 9535 slices) |
| **Compound filters (`?()`) & script expressions (`()`)** | ✅ | ❌ (throws) | Custom JS filter | ❌ (throws) | ❌ (throws) | Duck-typing `{prop}` only | Predicate fn only | ✅ |
| **RFC 9535 filters without parens (`?[?@.prop]`)** | ✅ | ❌ (throws) | ❌ | ❌ (parses, then throws) | ❌ (throws) | Duck-typing `{prop}` only | ❌ | ❌ (returns `[]`) |
| **RFC 9535 Unicode escapes (`\uXXXX`, surrogates) & I-JSON / shorthand** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ (no `\uXXXX` decode in `[]` / no bounds) |
| **RFC 9535 filter semantics (`Nothing`, falsy existence, no-coercion `==`, type-safe `<`/`>`)** | ✅ | ❌ | ❌ (JS custom) | ❌ | ❌ | ❌ | ❌ | ❌ (JS truthiness & `==` coercion) |
| **RFC 9535 heterogeneous unions & selector order/duplicates (`[2, 0, 2]`, `[0, 2:4, *]`)** | ✅ | Key/index only (no order/dups) | ❌ | Key/index only | Key/index only | ❌ | ❌ | Partial (no spaces, drops key+filter) |
| **RFC 9535 full queries in filters (`@..prop`, `@.tags[*]`) & root `$` references** | ✅ (pruned `$` + deferred stream) | ❌ (throws) | ❌ (JS custom) | ❌ (throws) | ❌ (throws) | ❌ | ❌ | ✅ (requires full JSON in RAM) |
| **RFC 9535 standard functions (`length`, `count`, `match`, `search`, `value`)** | ✅ (with RFC 9485 I-Regexp) | ❌ (throws) | ❌ (JS custom) | ❌ (throws) | ❌ (throws) | ❌ | ❌ | ❌ |
| **Safe missing intermediate property access in filters** | ✅ | N/A | N/A | N/A | N/A | N/A | N/A | ❌ (throws `TypeError`) |
| **Preserves JSON `null` values** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (skipped as EOF) | ✅ |
| **Built-in TypeScript declarations** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (DefinitelyTyped) | ❌ | ✅ |
