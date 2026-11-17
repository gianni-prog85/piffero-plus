# JSONPath Syntax & RFC 9535 Semantics Guide

`piffero-plus` implements [RFC 9535 (JSONPath)](https://www.rfc-editor.org/info/rfc9535/) semantics along with Goessner-style filter parentheses `?()` and script expressions `()`, executed directly over Node.js streams.

---

## 1. Quick Syntax Reference

| Selector / Construct | Syntax | Example | Behavior |
|---|---|---|---|
| **Root identifier** | `$` | `$` | Selects the root JSON value (must be the first character of every query) |
| **Current node** | `@` | `$[?@.active]` | Refers to the current candidate element inside filters or script expressions |
| **Dot child** | `.name` | `$.employees.name` | Selects object member `name` (must satisfy `member-name-shorthand`) |
| **Quoted child** | `['name']`, `["name"]` | `$['first-name']`, `$["\uD83D\uDE00"]` | Selects any object key, including special chars, spaces, and `\uXXXX` escapes |
| **Wildcard** | `.*`, `[*]` | `$.*`, `$.employees[*].name` | Selects all object property values or all array elements |
| **Recursive descent** | `..` | `$..number`, `$.employees..type`, `$..*` | Depth-first pre-order traversal across all nested containers |
| **Array index** | `[i]`, `[-i]` | `$[0]`, `$[-1]` | Selects element at index `i` (negative counts from the end; I-JSON safe integer) |
| **Array slice** | `[start:end:step]` | `$[0:10:2]`, `$[-2:]`, `$[10:0:-1]` | RFC 9535 slice algorithm; `step = 0` yields `[]` |
| **Union** | `[sel1, sel2, ...]` | `$[2, 0, 2]`, `$['b', 'a', 'b']`, `$[0, 2:4, *]` | Heterogeneous selectors; preserves **exact selector order and duplicates** |
| **Filter** | `?expr`, `?(expr)` | `$[?@.price < 20]`, `$[?(@.active === true)]` | Both RFC 9535 parenless `?` and Goessner `?()` forms |
| **Script expression** | `(expr)` | `$[(1+1)]`, `$[(@.length-1)]`, `$[($.idx)]` | Evaluates arithmetic or `@.length` / `$` expressions as an array index |

---

## 2. Member Names, Escapes & I-JSON Bounds

### `member-name-shorthand` (`.key`)
Dot notation `.key` enforces RFC 9535 shorthand rules:
- First character: `A–Z`, `a–z`, `_`, or non-ASCII Unicode (`U+0080–U+D7FF`, `U+E000–U+10FFFF`).
- Subsequent characters: same plus `0–9`.
- Keys starting with digits or containing hyphens/spaces/punctuation must use bracket notation:
  ```text
  $.user_1.name      ✅ valid
  $['first-name']    ✅ valid
  $.first-name       ❌ throws PifferoJsonPathError
  $.0                ❌ throws PifferoJsonPathError (use $[0] for arrays or $['0'] for object keys)
  ```

### Quoted Keys & Unicode Escapes
Single-quoted (`'...'`) and double-quoted (`"..."`) strings support:
- Standard JSON escapes: `\b`, `\f`, `\n`, `\r`, `\t`, `\/`, `\\`
- Quote-matching escapes: `\'` inside `'...'`, `\"` inside `"..."` (cross-quote escapes like `\"` inside `'...'` are rejected per RFC 9535)
- Unicode escapes `\uXXXX` and UTF-16 surrogate pairs (`\uD83D\uDE00` → `😀`)
- Lone surrogates and unescaped control characters (`U+0000–U+001F`) are rejected at compile time with `PifferoJsonPathError`.

### I-JSON Safe Integers
Array indices and slice bounds (`start`, `end`, `step`) must be valid integers without leading zeroes (`-0` and `01` are rejected) within JavaScript/I-JSON safe integer bounds (`Number.isSafeInteger`: `-(2^53 - 1)` to `2^53 - 1`).

---

## 3. Array Slices (`[start:end:step]`)

`piffero-plus` implements the official RFC 9535 slice `Bounds` algorithm:

- Defaults:
  - When `step > 0` (default `step = 1`): `start` defaults to `0`, `end` defaults to `length`.
  - When `step < 0`: `start` defaults to `length - 1`, `end` defaults to `-length - 1` (so `$[::-1]` reverses the full array).
  - When `step === 0`: always returns `[]`.
- Negative `start` or `end` values are normalized relative to `length` (`length + index`) and clamped to `[0, length]` (forward) or `[-1, length - 1]` (reverse).
- Explicit `end = 0` is handled accurately (e.g. `$[2:0:-1]` stops before index `0`, returning `[arr[2], arr[1]]`).

**Examples on `[10, 20, 30, 40, 50]`:**

```text
$[1:4]       => [20, 30, 40]
$[0:5:2]     => [10, 30, 50]
$[-2:]       => [40, 50]
$[::-1]      => [50, 40, 30, 20, 10]
$[3:0:-1]    => [40, 30, 20]
$[::0]       => []
```

---

## 4. Homogeneous & Heterogeneous Unions (`[,]`)

Bracket unions can combine any selectors—indices, slices, quoted keys, wildcards, filters, and scripts:

```text
$[2, 0, 2]                 // Preserves selector order & duplicates
$['b', 'a', 'b']           // Emits property 'b', then 'a', then 'b' again
$[0, 2:4, *]               // Mixed index + slice + wildcard
$['name', ?@.active]       // Mixed key + filter on an object or array
$[?@.price > 100, 0:2]     // Filter results followed by slice results
```

- **Performance note**: Simple strictly-increasing non-negative index unions (e.g. `$[0, 2, 5]`) and distinct key unions (e.g. `$['type', 'id']`) use specialized streaming fast-paths without collecting elements in memory.

---

## 5. Filters (`?` and `?()`)

Both RFC 9535 parenless filters (`$[?@.active]`) and Goessner parenthesized filters (`$[?(@.active)]`) are supported. Filters apply to both **array elements** and **object member values**.

### Existence Tests & `NOTHING` Semantics

In RFC 9535, a missing property evaluates to the sentinel `NOTHING` rather than JS `undefined`:

- **Present falsy values pass existence tests**: If an object has `{ "flag": false }`, `{ "count": 0 }`, `{ "label": "" }`, or `{ "note": null }`, `$[?@.flag]` **matches** it because the property exists.
- **Missing properties fail existence tests**: If `"flag"` is absent, `@.flag` evaluates to `NOTHING`, so `$[?@.flag]` does **not** match.
- **Negation `!`**: `$[?!@.flag]` matches only when `flag` is absent (or `!` negates a logical expression).
- **Safe deep navigation**: Missing intermediate properties like `@.payload.issue.number` evaluate safely to `NOTHING` without throwing `TypeError`.

### Comparison Operators

| Operator | Semantics in `piffero-plus` |
|---|---|
| `==`, `!=` | **RFC 9535 non-coercing equality**: `"1" == 1` is `false`; `NOTHING == NOTHING` is `true`; performs deep structural equality on arrays and objects (key-order independent for objects). |
| `===`, `!==` | Strict JavaScript identity equality (`===` / `!==`). |
| `<`, `<=`, `>`, `>=` | **Type-safe ordered comparison**: `<` / `>` return `true` only when both operands are `number` or both are `string` (never coerces `"1500" > 1000` or compares `NOTHING`). `<=` / `>=` combine `<`/`>` with `==`. |
| `&&`, `\|\|`, `!` | Short-circuit logical AND, OR, and NOT. |
| `+`, `-`, `*`, `/`, `%` | Arithmetic operators (propagate `NaN` if either side is `NOTHING`). |

### Sub-Queries (`@..`, `@[*]`) & Root References (`$`)

Filter expressions can embed full JSONPath queries anchored at either `@` (current candidate) or `$` (root document):

```text
// Recursive descent inside filter
$[?(@..price > 10)].id

// Wildcard / slice / nested filter inside filter
$[?(@.tags[*] == 'dev')].name
$[?(@.scores[1:3] == 20)].name
$[?(@.members[?@.active == true])].team

// Root ($) references — works whether $.maxPrice appears BEFORE or AFTER $.items in the stream
$.items[?(@.price < $.maxPrice && @.stock >= $.config.minStock)].name
$.values[?(@ < $.limit)]
$[?(@.price < $[0].limit)].price
```

> **Note on streaming with `$` references:** If a `$` field appears *after* the filtered array in the JSON stream, `piffero-plus` prunes only the referenced root paths (`rootProjection`) and defers filter evaluation for candidate matches until the root fields are read—keeping memory bounded instead of buffering the whole document.

---

## 6. RFC 9535 Standard Functions

`piffero-plus` validates function names, arity, and RFC 9535 argument types (`ValueType` vs `NodesType`) at compile time, throwing `PifferoJsonPathError` on invalid calls.

### `length(value)`
- **Argument**: 1 `ValueType` expression (e.g. `@.name`, `@.tags`, `@.meta`). Passing a non-singular query like `@.items[*]` throws `PifferoJsonPathError`.
- **Returns**:
  - `string` → number of **Unicode scalar values** (surrogate pairs such as `"😀"` count as `1`, not `2`)
  - `array` → number of elements
  - `object` → number of own keys
  - anything else (`number`, `boolean`, `null`, `NOTHING`) → `NOTHING`
- **Example**: `$.users[?length(@.tags) >= 2 && length(@.bio) == 3].id`

### `count(nodelist)`
- **Argument**: 1 `NodesType` expression (any query starting with `@` or `$`). Passing a literal like `count(1)` throws `PifferoJsonPathError`.
- **Returns**: integer count of nodes produced by the query.
- **Example**: `$.users[?count(@.scores[*]) > 1].id`

### `value(nodelist)`
- **Argument**: 1 `NodesType` expression.
- **Returns**: the single node value if the nodelist contains **exactly 1** node; otherwise `NOTHING`.
- **Example**: `$.users[?value(@.scores[*]) >= 95].id`

### `match(value, pattern)` & `search(value, pattern)`
- **Arguments**: 2 `ValueType` expressions `(inputString, iregexpPattern)`.
- **Returns**: `LogicalType` (`true` / `false`). Returns `false` if either argument is not a string or if the pattern is not a valid [I-Regexp (RFC 9485)](https://www.rfc-editor.org/info/rfc9485/) pattern.
- **Difference**:
  - `match(str, pat)` requires the **entire string** to match `pat`.
  - `search(str, pat)` succeeds if **any substring** of `str` matches `pat`.
- **I-Regexp (RFC 9485) compliance**:
  - Supports character classes `[a-z]`, `[^0-9]`, quantifiers `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`, alternation `|`, groups `(...)`, `.` (matches `[^\n\r]`), standard escapes (`\n`, `\r`, `\t`, `\\`, `\|`, `\.`, etc.), and Unicode property escapes `\p{L}`, `\p{Nd}`, `\P{Z}`, etc.
  - Disallows JS-specific extensions: `\d`, `\w`, `\s`, `\b`, backreferences `\1`, `\u`/`\x`, unescaped `^`/`$` anchors outside `[...]`, `(?...)` lookarounds/non-capturing groups, and lazy quantifiers (`*?`, `+?`, `??`).
- **Examples**:
  ```text
  $.users[?match(@.name, "[A-Z][a-z]+")].id
  $.users[?search(@.name, "[0-9]+")].id
  ```

---

## 7. Script Expressions (`(...)`)

Script expressions compute an integer array index dynamically:

```text
$.employees[(1+1)].name          // Static constant index -> index 2
$.employees[(@.length-1)].name   // Tail index -> runs in O(1) element buffer via tailKeep
$.items[($.idx)]                 // Dynamic index from root document
```

---

## 8. Common Invalid Queries (`PifferoJsonPathError`)

The following queries throw `PifferoJsonPathError` synchronously when passed to `Piffero.findByPath`, `findAsString`, or `findAsPromise`:

- Missing leading `$`: `"employees[0]"`
- Empty or trailing dots: `"$."`, `"$.."`, `"$...a"`
- Unclosed brackets or quotes: `"$.employees[0"`, `"$['name]"`
- Empty union / trailing comma: `"$[]"`, `"$[1, ]"`, `"$[, 1]"`
- Invalid shorthand key: `"$.my-key"` (use `"$['my-key']"`)
- Non-I-JSON integer / leading zero: `"$[01]"`, `"$[-0]"`
- Unknown function or wrong RFC 9535 parameter type: `"$[?unknown(@.a)]"`, `"$[?length(@.items[*]) > 0]"`, `"$[?count(1) > 0]"`
