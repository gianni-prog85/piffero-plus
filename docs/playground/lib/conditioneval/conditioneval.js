function hasLoneSurrogate(str) {
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (i + 1 >= str.length) {
                return true;
            }
            const next = str.charCodeAt(i + 1);
            if (next < 0xDC00 || next > 0xDFFF) {
                return true;
            }
            i++;
        }
        else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }
    return false;
}
export function decodeJsonPathStringInner(inner, quote) {
    if (inner.indexOf("\\") === -1) {
        if (/[\u0000-\u001F]/.test(inner)) {
            throw new Error("Unescaped control character in string literal");
        }
        if (/[\uD800-\uDFFF]/.test(inner) && hasLoneSurrogate(inner)) {
            throw new Error("Lone UTF-16 surrogate in string literal");
        }
        return inner;
    }
    let out = "";
    const len = inner.length;
    for (let i = 0; i < len; i++) {
        const ch = inner[i];
        if (ch === "\\") {
            if (i + 1 >= len) {
                throw new Error("Trailing backslash in string literal");
            }
            const next = inner[++i];
            switch (next) {
                case "b":
                    out += "\b";
                    break;
                case "f":
                    out += "\f";
                    break;
                case "n":
                    out += "\n";
                    break;
                case "r":
                    out += "\r";
                    break;
                case "t":
                    out += "\t";
                    break;
                case "/":
                    out += "/";
                    break;
                case "\\":
                    out += "\\";
                    break;
                case "'":
                    if (quote === '"') {
                        throw new Error("Invalid escape \\' in double-quoted string literal");
                    }
                    out += "'";
                    break;
                case '"':
                    if (quote === "'") {
                        throw new Error('Invalid escape \\" in single-quoted string literal');
                    }
                    out += '"';
                    break;
                case "`":
                    if (quote !== "`") {
                        throw new Error("Invalid escape \\` in string literal");
                    }
                    out += "`";
                    break;
                case "u": {
                    if (i + 4 >= len) {
                        throw new Error("Incomplete Unicode escape sequence \\u");
                    }
                    const hex = inner.slice(i + 1, i + 5);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                        throw new Error(`Invalid Unicode escape sequence \\u${hex}`);
                    }
                    const code = parseInt(hex, 16);
                    i += 4;
                    if (code >= 0xD800 && code <= 0xDBFF) {
                        if (i + 6 >= len || inner[i + 1] !== "\\" || inner[i + 2] !== "u") {
                            throw new Error(`Lone high surrogate \\u${hex} in string literal`);
                        }
                        const lowHex = inner.slice(i + 3, i + 7);
                        if (!/^[0-9a-fA-F]{4}$/.test(lowHex)) {
                            throw new Error(`Invalid Unicode escape sequence \\u${lowHex}`);
                        }
                        const lowCode = parseInt(lowHex, 16);
                        if (lowCode < 0xDC00 || lowCode > 0xDFFF) {
                            throw new Error(`Invalid low surrogate \\u${lowHex} in string literal`);
                        }
                        out += String.fromCharCode(code, lowCode);
                        i += 6;
                    }
                    else if (code >= 0xDC00 && code <= 0xDFFF) {
                        throw new Error(`Lone low surrogate \\u${hex} in string literal`);
                    }
                    else {
                        out += String.fromCharCode(code);
                    }
                    break;
                }
                default:
                    throw new Error(`Invalid escape sequence \\${next} in string literal`);
            }
        }
        else {
            const code = ch.charCodeAt(0);
            if (code < 0x20) {
                throw new Error("Unescaped control character in string literal");
            }
            if (code >= 0xD800 && code <= 0xDBFF) {
                if (i + 1 >= len) {
                    throw new Error("Lone high surrogate in string literal");
                }
                const nextCode = inner.charCodeAt(i + 1);
                if (nextCode < 0xDC00 || nextCode > 0xDFFF) {
                    throw new Error("Lone high surrogate in string literal");
                }
                out += ch + inner[++i];
            }
            else if (code >= 0xDC00 && code <= 0xDFFF) {
                throw new Error("Lone low surrogate in string literal");
            }
            else {
                out += ch;
            }
        }
    }
    return out;
}
function unescapeStringLiteral(raw) {
    return decodeJsonPathStringInner(raw.slice(1, -1), raw[0]);
}
function isQueryMemberFirst(cp) {
    return ((cp >= 0x41 && cp <= 0x5A) ||
        (cp >= 0x61 && cp <= 0x7A) ||
        cp === 0x5F ||
        (cp >= 0x80 && cp <= 0xD7FF) ||
        (cp >= 0xE000 && cp <= 0x10FFFF));
}
function isQueryMemberChar(cp) {
    return isQueryMemberFirst(cp) || (cp >= 0x30 && cp <= 0x39);
}
function scanBalancedBracket(expr, openIdx) {
    let depth = 0;
    let i = openIdx;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            i++;
            let closed = false;
            while (i < expr.length) {
                if (expr[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (expr[i] === quote) {
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed) {
                return -1;
            }
            continue;
        }
        if (ch === "[") {
            depth++;
        }
        else if (ch === "]") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
        i++;
    }
    return -1;
}
function bracketInnerIsComplex(inner) {
    const trimmed = inner.trim();
    if (trimmed.startsWith("?") || trimmed === "*") {
        return true;
    }
    let i = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (i < trimmed.length) {
        const ch = trimmed[i];
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            i++;
            while (i < trimmed.length) {
                if (trimmed[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (trimmed[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (ch === "(")
            parenDepth++;
        else if (ch === ")")
            parenDepth--;
        else if (ch === "[")
            bracketDepth++;
        else if (ch === "]")
            bracketDepth--;
        else if (parenDepth === 0 && bracketDepth === 0) {
            if (ch === "," || ch === ":") {
                return true;
            }
        }
        i++;
    }
    return false;
}
function tryScanComplexFilterQuery(expr, startIdx) {
    const len = expr.length;
    let pos = startIdx + 1;
    let hasComplex = false;
    while (pos < len) {
        const ch = expr[pos];
        if (ch === ".") {
            if (pos + 1 < len && expr[pos + 1] === ".") {
                // Recursive descent `..`
                hasComplex = true;
                pos += 2;
                if (pos >= len) {
                    // Malformed trailing `..`: capture so compileQuery raises PifferoJsonPathError
                    return { endIdx: pos, rawPath: "$" + expr.slice(startIdx + 1, pos) };
                }
                if (expr[pos] === "[") {
                    const closeIdx = scanBalancedBracket(expr, pos);
                    if (closeIdx === -1) {
                        return { endIdx: len, rawPath: "$" + expr.slice(startIdx + 1) };
                    }
                    pos = closeIdx + 1;
                }
                else if (expr[pos] === "*") {
                    pos++;
                }
                else {
                    const cp = expr.codePointAt(pos);
                    if (cp !== undefined && isQueryMemberFirst(cp)) {
                        pos += cp > 0xFFFF ? 2 : 1;
                        while (pos < len) {
                            const c2 = expr.codePointAt(pos);
                            if (c2 === undefined || !isQueryMemberChar(c2))
                                break;
                            pos += c2 > 0xFFFF ? 2 : 1;
                        }
                    }
                    else {
                        return { endIdx: pos, rawPath: "$" + expr.slice(startIdx + 1, pos) };
                    }
                }
            }
            else if (pos + 1 < len && expr[pos + 1] === "*") {
                // Wildcard `.*`
                hasComplex = true;
                pos += 2;
            }
            else {
                // Shorthand `.name`
                const cp = pos + 1 < len ? expr.codePointAt(pos + 1) : undefined;
                if (cp === undefined || !isQueryMemberFirst(cp)) {
                    break;
                }
                pos += 1 + (cp > 0xFFFF ? 2 : 1);
                while (pos < len) {
                    const c2 = expr.codePointAt(pos);
                    if (c2 === undefined || !isQueryMemberChar(c2))
                        break;
                    pos += c2 > 0xFFFF ? 2 : 1;
                }
            }
        }
        else if (ch === "[") {
            const closeIdx = scanBalancedBracket(expr, pos);
            if (closeIdx === -1) {
                if (hasComplex) {
                    return { endIdx: len, rawPath: "$" + expr.slice(startIdx + 1) };
                }
                break;
            }
            const inner = expr.slice(pos + 1, closeIdx);
            if (bracketInnerIsComplex(inner)) {
                hasComplex = true;
            }
            pos = closeIdx + 1;
        }
        else {
            break;
        }
    }
    if (!hasComplex) {
        return null;
    }
    return {
        endIdx: pos,
        rawPath: "$" + expr.slice(startIdx + 1, pos),
    };
}
function tokenizeExpression(expr) {
    const tokens = [];
    let i = 0;
    const len = expr.length;
    while (i < len) {
        const ch = expr[i];
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
            i++;
            continue;
        }
        // String literals
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            let j = i + 1;
            let closed = false;
            while (j < len) {
                if (expr[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (expr[j] === quote) {
                    j++;
                    closed = true;
                    break;
                }
                j++;
            }
            if (!closed) {
                throw new Error(`Unterminated string literal in expression: ${expr}`);
            }
            tokens.push({
                type: "string",
                value: unescapeStringLiteral(expr.slice(i, j)),
            });
            i = j;
            continue;
        }
        // Multi-char operators
        const three = expr.slice(i, i + 3);
        if (three === "===" || three === "!==") {
            tokens.push({ type: "op", value: three });
            i += 3;
            continue;
        }
        const two = expr.slice(i, i + 2);
        if (two === "==" ||
            two === "!=" ||
            two === ">=" ||
            two === "<=" ||
            two === "&&" ||
            two === "||") {
            tokens.push({ type: "op", value: two });
            i += 2;
            continue;
        }
        // Numbers
        if ((ch >= "0" && ch <= "9") ||
            (ch === "." && i + 1 < len && expr[i + 1] >= "0" && expr[i + 1] <= "9")) {
            const rest = expr.slice(i);
            const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(rest);
            if (m) {
                tokens.push({ type: "number", value: m[0] });
                i += m[0].length;
                continue;
            }
        }
        if (ch === "@") {
            const scanned = tryScanComplexFilterQuery(expr, i);
            if (scanned) {
                tokens.push({
                    type: "query",
                    value: scanned.rawPath,
                    isRoot: false,
                });
                i = scanned.endIdx;
            }
            else {
                tokens.push({ type: "at", value: "@" });
                i++;
            }
            continue;
        }
        if (ch === "$") {
            const scanned = tryScanComplexFilterQuery(expr, i);
            if (scanned) {
                tokens.push({
                    type: "query",
                    value: scanned.rawPath,
                    isRoot: true,
                });
                i = scanned.endIdx;
            }
            else {
                tokens.push({ type: "dollar", value: "$" });
                i++;
            }
            continue;
        }
        if (ch === "(" ||
            ch === ")" ||
            ch === "[" ||
            ch === "]" ||
            ch === "." ||
            ch === ",") {
            tokens.push({ type: "punct", value: ch });
            i++;
            continue;
        }
        if (ch === ">" ||
            ch === "<" ||
            ch === "+" ||
            ch === "-" ||
            ch === "*" ||
            ch === "/" ||
            ch === "%" ||
            ch === "!") {
            tokens.push({ type: "op", value: ch });
            i++;
            continue;
        }
        if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
            let j = i + 1;
            while (j < len &&
                ((expr[j] >= "a" && expr[j] <= "z") ||
                    (expr[j] >= "A" && expr[j] <= "Z") ||
                    (expr[j] >= "0" && expr[j] <= "9") ||
                    expr[j] === "_" ||
                    expr[j] === "$")) {
                j++;
            }
            tokens.push({ type: "ident", value: expr.slice(i, j) });
            i = j;
            continue;
        }
        throw new Error(`Unexpected token '${ch}' in expression: ${expr}`);
    }
    return tokens;
}
function isSingularQueryNode(node) {
    let cur = node;
    while (true) {
        if (cur.type === "current" || cur.type === "root") {
            return true;
        }
        if (cur.type === "member") {
            cur = cur.object;
            continue;
        }
        if (cur.type === "index") {
            if (cur.index.type !== "literal" ||
                (typeof cur.index.value !== "string" &&
                    !(typeof cur.index.value === "number" && Number.isInteger(cur.index.value)))) {
                return false;
            }
            cur = cur.object;
            continue;
        }
        return false;
    }
}
function getExprType(node) {
    switch (node.type) {
        case "query":
            return "NodesType";
        case "current":
        case "root":
        case "member":
        case "index":
            return isSingularQueryNode(node) ? "ValueType" : "ValueType";
        case "logical":
            return "LogicalType";
        case "unary":
            return node.op === "!" ? "LogicalType" : "ValueType";
        case "binary":
            return node.op === "===" ||
                node.op === "!==" ||
                node.op === "==" ||
                node.op === "!=" ||
                node.op === "<" ||
                node.op === "<=" ||
                node.op === ">" ||
                node.op === ">="
                ? "LogicalType"
                : "ValueType";
        case "call":
            return node.name === "match" || node.name === "search"
                ? "LogicalType"
                : "ValueType";
        case "literal":
        case "identifier":
            return "ValueType";
    }
}
function isNodesTypeArg(node) {
    return node.type === "query" || isSingularQueryNode(node);
}
function isValueTypeArg(node) {
    if (node.type === "query") {
        return false;
    }
    return getExprType(node) === "ValueType";
}
const IREGEXP_CACHE_MAX = 1024;
const iRegexpCache = new Map();
const IREGEXP_UNICODE_CATEGORIES = new Set([
    "L", "Lu", "Ll", "Lt", "Lm", "Lo",
    "M", "Mn", "Mc", "Me",
    "N", "Nd", "Nl", "No",
    "P", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
    "Z", "Zs", "Zl", "Zp",
    "S", "Sm", "Sc", "Sk", "So",
    "C", "Cc", "Cf", "Co", "Cn",
]);
function translateIRegexp(pattern) {
    let out = "";
    let inCharClass = false;
    const len = pattern.length;
    for (let i = 0; i < len; i++) {
        const ch = pattern[i];
        if (ch === "\\") {
            if (i + 1 >= len) {
                return null;
            }
            const next = pattern[++i];
            if (next === "n" ||
                next === "r" ||
                next === "t" ||
                next === "\\" ||
                next === "|" ||
                next === "." ||
                next === "-" ||
                next === "^" ||
                next === "?" ||
                next === "*" ||
                next === "+" ||
                next === "{" ||
                next === "}" ||
                next === "(" ||
                next === ")" ||
                next === "[" ||
                next === "]" ||
                next === "/") {
                out += "\\" + next;
                continue;
            }
            if (next === "p" || next === "P") {
                if (i + 1 >= len || pattern[i + 1] !== "{") {
                    return null;
                }
                const closeBrace = pattern.indexOf("}", i + 2);
                if (closeBrace === -1) {
                    return null;
                }
                const cat = pattern.slice(i + 2, closeBrace);
                if (!IREGEXP_UNICODE_CATEGORIES.has(cat)) {
                    return null;
                }
                out += "\\" + next + "{" + cat + "}";
                i = closeBrace;
                continue;
            }
            // Disallow JS-only escapes such as \d, \w, \s, \b, \1, \u, \x, etc.
            return null;
        }
        if (inCharClass) {
            if (ch === "]") {
                inCharClass = false;
                out += "]";
                continue;
            }
            if (ch === "[") {
                // Unescaped '[' inside charClass is invalid in I-Regexp
                return null;
            }
            out += ch;
            continue;
        }
        if (ch === "[") {
            inCharClass = true;
            out += "[";
            if (i + 1 < len && pattern[i + 1] === "^") {
                out += "^";
                i++;
            }
            // Disallow empty character class [] or [^]
            if (i + 1 >= len || pattern[i + 1] === "]") {
                return null;
            }
            continue;
        }
        if (ch === "]") {
            return null;
        }
        if (ch === "^" || ch === "$") {
            // Unescaped ^ and $ outside [...] are invalid in I-Regexp (RFC 9485)
            return null;
        }
        if (ch === ".") {
            out += "[^\\n\\r]";
            continue;
        }
        if (ch === "(") {
            // Disallow (?...) non-capturing, lookahead, named groups, etc.
            if (i + 1 < len && pattern[i + 1] === "?") {
                return null;
            }
            out += "(";
            continue;
        }
        if (ch === "*" || ch === "+" || ch === "?") {
            // Disallow lazy quantifiers (*?, +?, ??)
            if (i + 1 < len && pattern[i + 1] === "?") {
                return null;
            }
            out += ch;
            continue;
        }
        if (ch === "{") {
            const closeBrace = pattern.indexOf("}", i + 1);
            if (closeBrace === -1) {
                return null;
            }
            const quant = pattern.slice(i + 1, closeBrace);
            if (!/^[0-9]+(?:,[0-9]*)?$/.test(quant)) {
                return null;
            }
            if (closeBrace + 1 < len && pattern[closeBrace + 1] === "?") {
                return null;
            }
            out += "{" + quant + "}";
            i = closeBrace;
            continue;
        }
        out += ch;
    }
    if (inCharClass) {
        return null;
    }
    return out;
}
function compileIRegexp(pattern, fullMatch) {
    const cacheKey = (fullMatch ? "M:" : "S:") + pattern;
    const cached = iRegexpCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }
    const translated = translateIRegexp(pattern);
    let compiled = null;
    if (translated !== null) {
        try {
            compiled = new RegExp(fullMatch ? `^(?:${translated})$` : translated, "u");
        }
        catch {
            compiled = null;
        }
    }
    if (iRegexpCache.size >= IREGEXP_CACHE_MAX) {
        const firstKey = iRegexpCache.keys().next().value;
        if (firstKey !== undefined) {
            iRegexpCache.delete(firstKey);
        }
    }
    iRegexpCache.set(cacheKey, compiled);
    return compiled;
}
function lengthValue(val) {
    if (typeof val === "string") {
        if (!/[\uD800-\uDFFF]/.test(val)) {
            return val.length;
        }
        let count = 0;
        for (let i = 0; i < val.length; i++) {
            const code = val.charCodeAt(i);
            count++;
            if (code >= 0xD800 && code <= 0xDBFF && i + 1 < val.length) {
                const next = val.charCodeAt(i + 1);
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    i++;
                }
            }
        }
        return count;
    }
    if (Array.isArray(val)) {
        return val.length;
    }
    if (val !== null && typeof val === "object" && val !== NOTHING) {
        return Object.keys(val).length;
    }
    return NOTHING;
}
function buildValidatedCallNode(name, args, rawExpr) {
    switch (name) {
        case "length": {
            if (args.length !== 1 || !isValueTypeArg(args[0])) {
                throw new Error(`Function 'length' expects 1 ValueType argument in expression: ${rawExpr}`);
            }
            return { type: "call", name, args };
        }
        case "count": {
            if (args.length !== 1 || !isNodesTypeArg(args[0])) {
                throw new Error(`Function 'count' expects 1 NodesType argument in expression: ${rawExpr}`);
            }
            return { type: "call", name, args };
        }
        case "value": {
            if (args.length !== 1 || !isNodesTypeArg(args[0])) {
                throw new Error(`Function 'value' expects 1 NodesType argument in expression: ${rawExpr}`);
            }
            return { type: "call", name, args };
        }
        case "match":
        case "search": {
            if (args.length !== 2 ||
                !isValueTypeArg(args[0]) ||
                !isValueTypeArg(args[1])) {
                throw new Error(`Function '${name}' expects 2 ValueType arguments in expression: ${rawExpr}`);
            }
            const isMatch = name === "match";
            let compiledRegex = undefined;
            if (args[1].type === "literal") {
                compiledRegex =
                    typeof args[1].value === "string"
                        ? compileIRegexp(args[1].value, isMatch)
                        : null;
            }
            return { type: "call", name, args, compiledRegex };
        }
        default:
            throw new Error(`Unknown JSONPath function '${name}' in expression: ${rawExpr}`);
    }
}
class ExprParser {
    constructor(tokens, raw) {
        this.tokens = tokens;
        this.raw = raw;
        this.pos = 0;
    }
    parse() {
        if (this.tokens.length === 0) {
            throw new Error(`Empty expression: ${this.raw}`);
        }
        const node = this.parseOr();
        if (this.pos < this.tokens.length) {
            throw new Error(`Unexpected token '${this.tokens[this.pos].value}' in expression: ${this.raw}`);
        }
        return node;
    }
    peek() {
        return this.tokens[this.pos];
    }
    consume() {
        return this.tokens[this.pos++];
    }
    parseOr() {
        let left = this.parseAnd();
        while (this.peek()?.type === "op" && this.peek()?.value === "||") {
            this.consume();
            const right = this.parseAnd();
            left = { type: "logical", op: "||", left, right };
        }
        return left;
    }
    parseAnd() {
        let left = this.parseEquality();
        while (this.peek()?.type === "op" && this.peek()?.value === "&&") {
            this.consume();
            const right = this.parseEquality();
            left = { type: "logical", op: "&&", left, right };
        }
        return left;
    }
    parseEquality() {
        let left = this.parseRelational();
        while (this.peek()?.type === "op" &&
            (this.peek()?.value === "===" ||
                this.peek()?.value === "!==" ||
                this.peek()?.value === "==" ||
                this.peek()?.value === "!=")) {
            const op = this.consume().value;
            const right = this.parseRelational();
            left = { type: "binary", op, left, right };
        }
        return left;
    }
    parseRelational() {
        let left = this.parseAdditive();
        while (this.peek()?.type === "op" &&
            (this.peek()?.value === "<" ||
                this.peek()?.value === "<=" ||
                this.peek()?.value === ">" ||
                this.peek()?.value === ">=")) {
            const op = this.consume().value;
            const right = this.parseAdditive();
            left = { type: "binary", op, left, right };
        }
        return left;
    }
    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.peek()?.type === "op" &&
            (this.peek()?.value === "+" || this.peek()?.value === "-")) {
            const op = this.consume().value;
            const right = this.parseMultiplicative();
            left = { type: "binary", op, left, right };
        }
        return left;
    }
    parseMultiplicative() {
        let left = this.parseUnary();
        while (this.peek()?.type === "op" &&
            (this.peek()?.value === "*" ||
                this.peek()?.value === "/" ||
                this.peek()?.value === "%")) {
            const op = this.consume().value;
            const right = this.parseUnary();
            left = { type: "binary", op, left, right };
        }
        return left;
    }
    parseUnary() {
        const tok = this.peek();
        if (tok &&
            tok.type === "op" &&
            (tok.value === "!" || tok.value === "-" || tok.value === "+")) {
            this.consume();
            return {
                type: "unary",
                op: tok.value,
                argument: this.parseUnary(),
            };
        }
        return this.parsePostfix();
    }
    parsePostfix() {
        let node = this.parsePrimary();
        while (this.peek()?.type === "punct") {
            const p = this.peek().value;
            if (p === ".") {
                this.consume();
                const propTok = this.peek();
                if (!propTok || propTok.type !== "ident") {
                    throw new Error(`Expected property name after '.' in expression: ${this.raw}`);
                }
                this.consume();
                node = { type: "member", object: node, property: propTok.value };
            }
            else if (p === "[") {
                this.consume();
                const indexExpr = this.parseOr();
                const closeTok = this.peek();
                if (!closeTok || closeTok.type !== "punct" || closeTok.value !== "]") {
                    throw new Error(`Expected ']' in expression: ${this.raw}`);
                }
                this.consume();
                node = { type: "index", object: node, index: indexExpr };
            }
            else {
                break;
            }
        }
        return node;
    }
    parsePrimary() {
        const tok = this.peek();
        if (!tok) {
            throw new Error(`Unexpected end of expression: ${this.raw}`);
        }
        if (tok.type === "punct" && tok.value === "(") {
            this.consume();
            const inner = this.parseOr();
            const closeTok = this.peek();
            if (!closeTok || closeTok.type !== "punct" || closeTok.value !== ")") {
                throw new Error(`Unclosed '(' in expression: ${this.raw}`);
            }
            this.consume();
            return inner;
        }
        if (tok.type === "at") {
            this.consume();
            return { type: "current" };
        }
        if (tok.type === "dollar") {
            this.consume();
            return { type: "root" };
        }
        if (tok.type === "number") {
            this.consume();
            return { type: "literal", value: Number(tok.value) };
        }
        if (tok.type === "string") {
            this.consume();
            return { type: "literal", value: tok.value };
        }
        if (tok.type === "ident") {
            this.consume();
            if (this.peek()?.type === "punct" && this.peek()?.value === "(") {
                this.consume(); // consume '('
                const args = [];
                if (!(this.peek()?.type === "punct" && this.peek()?.value === ")")) {
                    while (true) {
                        args.push(this.parseOr());
                        const sep = this.peek();
                        if (sep?.type === "punct" && sep.value === ",") {
                            this.consume();
                            continue;
                        }
                        break;
                    }
                }
                const closeTok = this.peek();
                if (!closeTok || closeTok.type !== "punct" || closeTok.value !== ")") {
                    throw new Error(`Expected ')' after function arguments in expression: ${this.raw}`);
                }
                this.consume();
                return buildValidatedCallNode(tok.value, args, this.raw);
            }
            if (tok.value === "true")
                return { type: "literal", value: true };
            if (tok.value === "false")
                return { type: "literal", value: false };
            if (tok.value === "null")
                return { type: "literal", value: null };
            if (tok.value === "undefined")
                return { type: "literal", value: undefined };
            return { type: "identifier", name: tok.value };
        }
        if (tok.type === "query") {
            this.consume();
            const steps = ConditionEval.compileQuerySteps(tok.value);
            return {
                type: "query",
                isRoot: Boolean(tok.isRoot),
                rawPath: tok.value,
                steps,
            };
        }
        throw new Error(`Unexpected token '${tok.value}' in expression: ${this.raw}`);
    }
}
export const NOTHING = Symbol("NOTHING");
const hasOwn = typeof Object.hasOwn === "function"
    ? Object.hasOwn
    : (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export function rfc9535Equals(a, b) {
    if (a === b) {
        return true;
    }
    if (a === NOTHING || b === NOTHING || a === null || b === null) {
        return false;
    }
    if (typeof a !== typeof b || typeof a !== "object") {
        return false;
    }
    const aIsArr = Array.isArray(a);
    if (aIsArr !== Array.isArray(b)) {
        return false;
    }
    if (aIsArr) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!rfc9535Equals(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
        return false;
    }
    for (let i = 0; i < keysA.length; i++) {
        const k = keysA[i];
        if (!hasOwn(b, k) || !rfc9535Equals(a[k], b[k])) {
            return false;
        }
    }
    return true;
}
function rfc9535LessThan(a, b) {
    if (typeof a === "number" && typeof b === "number") {
        return a < b;
    }
    if (typeof a === "string" && typeof b === "string") {
        return a < b;
    }
    return false;
}
export class ConditionEval {
    static registerQueryHooks(hooks) {
        this.queryHooks = hooks;
    }
    static getQueryHooks() {
        if (!this.queryHooks) {
            throw new Error("Query evaluator hooks are not registered");
        }
        return this.queryHooks;
    }
    static compileQuerySteps(rawPath) {
        return this.getQueryHooks().compileQuery(rawPath);
    }
    static evaluateQuerySteps(baseValue, steps, rootValue) {
        if (baseValue === undefined || baseValue === NOTHING) {
            return [];
        }
        return this.getQueryHooks().evaluateSteps(baseValue, steps, 0, rootValue);
    }
    static evalQueryNodelist(node, currentValue, rootValue) {
        const base = node.isRoot ? rootValue : currentValue;
        return this.evaluateQuerySteps(base, node.steps, rootValue);
    }
    static createCondition(condition) {
        const tokens = [];
        const regex = /===|!==|==|!=|>=|<=|&&|\|\||[()!.<>+\-*/]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[0-9]+(?:\.[0-9]+)?|[a-zA-Z_$][a-zA-Z0-9_$]*/g;
        let match;
        while ((match = regex.exec(condition)) !== null) {
            const val = match[0];
            let type = "Punctuator";
            if (/^[0-9]/.test(val)) {
                type = "Numeric";
            }
            else if (val.startsWith('"') ||
                val.startsWith("'") ||
                val.startsWith("`")) {
                type = "String";
            }
            else if (val === "true" || val === "false") {
                type = "Boolean";
            }
            else if (val === "null") {
                type = "Null";
            }
            else if (/^[a-zA-Z_$]/.test(val)) {
                type = "Identifier";
            }
            tokens.push({ type, value: val });
        }
        return tokens;
    }
    static compile(expr) {
        const cached = this.astCache.get(expr);
        if (cached) {
            return cached;
        }
        const tokens = tokenizeExpression(expr);
        const ast = new ExprParser(tokens, expr).parse();
        this.astCache.set(expr, ast);
        return ast;
    }
    static evalComparison(op, left, right) {
        switch (op) {
            case "===":
                return left === right;
            case "!==":
                return left !== right;
            case "==":
                return (left === right ||
                    (left !== null &&
                        right !== null &&
                        typeof left === "object" &&
                        typeof right === "object" &&
                        rfc9535Equals(left, right)));
            case "!=":
                return !(left === right ||
                    (left !== null &&
                        right !== null &&
                        typeof left === "object" &&
                        typeof right === "object" &&
                        rfc9535Equals(left, right)));
            case "<":
                return rfc9535LessThan(left, right);
            case "<=":
                return (rfc9535LessThan(left, right) ||
                    left === right ||
                    (left !== null &&
                        right !== null &&
                        typeof left === "object" &&
                        typeof right === "object" &&
                        rfc9535Equals(left, right)));
            case ">":
                return rfc9535LessThan(right, left);
            case ">=":
                return (rfc9535LessThan(right, left) ||
                    left === right ||
                    (left !== null &&
                        right !== null &&
                        typeof left === "object" &&
                        typeof right === "object" &&
                        rfc9535Equals(left, right)));
        }
    }
    static evalNodelistComparison(op, leftArr, rightArr) {
        if (op === "!=" || op === "!==") {
            const eqOp = op === "!==" ? "===" : "==";
            for (let i = 0; i < leftArr.length; i++) {
                for (let j = 0; j < rightArr.length; j++) {
                    if (this.evalComparison(eqOp, leftArr[i], rightArr[j])) {
                        return false;
                    }
                }
            }
            return true;
        }
        for (let i = 0; i < leftArr.length; i++) {
            for (let j = 0; j < rightArr.length; j++) {
                if (this.evalComparison(op, leftArr[i], rightArr[j])) {
                    return true;
                }
            }
        }
        return false;
    }
    static evalFilterAst(node, currentValue, rootValue) {
        switch (node.type) {
            case "logical": {
                if (node.op === "&&") {
                    return (this.evalFilterAst(node.left, currentValue, rootValue) &&
                        this.evalFilterAst(node.right, currentValue, rootValue));
                }
                return (this.evalFilterAst(node.left, currentValue, rootValue) ||
                    this.evalFilterAst(node.right, currentValue, rootValue));
            }
            case "unary": {
                if (node.op === "!") {
                    return !this.evalFilterAst(node.argument, currentValue, rootValue);
                }
                const val = this.evalAst(node, currentValue, rootValue);
                return val !== NOTHING && Boolean(val);
            }
            case "query": {
                return (this.evalQueryNodelist(node, currentValue, rootValue).length > 0);
            }
            case "binary": {
                if ((node.left.type === "query" || node.right.type === "query") &&
                    (node.op === "===" ||
                        node.op === "!==" ||
                        node.op === "==" ||
                        node.op === "!=" ||
                        node.op === "<" ||
                        node.op === "<=" ||
                        node.op === ">" ||
                        node.op === ">=")) {
                    const leftRaw = node.left.type === "query"
                        ? this.evalQueryNodelist(node.left, currentValue, rootValue)
                        : [
                            node.left.type === "literal"
                                ? node.left.value
                                : node.left.type === "current"
                                    ? currentValue === undefined
                                        ? NOTHING
                                        : currentValue
                                    : this.evalAst(node.left, currentValue, rootValue),
                        ];
                    const rightRaw = node.right.type === "query"
                        ? this.evalQueryNodelist(node.right, currentValue, rootValue)
                        : [
                            node.right.type === "literal"
                                ? node.right.value
                                : node.right.type === "current"
                                    ? currentValue === undefined
                                        ? NOTHING
                                        : currentValue
                                    : this.evalAst(node.right, currentValue, rootValue),
                        ];
                    const leftNodes = leftRaw.length === 0 ? [NOTHING] : leftRaw;
                    const rightNodes = rightRaw.length === 0 ? [NOTHING] : rightRaw;
                    return this.evalNodelistComparison(node.op, leftNodes, rightNodes);
                }
                const left = node.left.type === "literal"
                    ? node.left.value
                    : node.left.type === "current"
                        ? currentValue === undefined
                            ? NOTHING
                            : currentValue
                        : this.evalAst(node.left, currentValue, rootValue);
                const right = node.right.type === "literal"
                    ? node.right.value
                    : node.right.type === "current"
                        ? currentValue === undefined
                            ? NOTHING
                            : currentValue
                        : this.evalAst(node.right, currentValue, rootValue);
                switch (node.op) {
                    case "===":
                        return left === right;
                    case "!==":
                        return left !== right;
                    case "==":
                        return (left === right ||
                            (left !== null &&
                                right !== null &&
                                typeof left === "object" &&
                                typeof right === "object" &&
                                rfc9535Equals(left, right)));
                    case "!=":
                        return !(left === right ||
                            (left !== null &&
                                right !== null &&
                                typeof left === "object" &&
                                typeof right === "object" &&
                                rfc9535Equals(left, right)));
                    case "<":
                        return (typeof left === "number" && typeof right === "number") ||
                            (typeof left === "string" && typeof right === "string")
                            ? left < right
                            : false;
                    case "<=":
                        return (((typeof left === "number" && typeof right === "number") ||
                            (typeof left === "string" && typeof right === "string")
                            ? left < right
                            : false) ||
                            left === right ||
                            (left !== null &&
                                right !== null &&
                                typeof left === "object" &&
                                typeof right === "object" &&
                                rfc9535Equals(left, right)));
                    case ">":
                        return (typeof left === "number" && typeof right === "number") ||
                            (typeof left === "string" && typeof right === "string")
                            ? left > right
                            : false;
                    case ">=":
                        return (((typeof left === "number" && typeof right === "number") ||
                            (typeof left === "string" && typeof right === "string")
                            ? left > right
                            : false) ||
                            left === right ||
                            (left !== null &&
                                right !== null &&
                                typeof left === "object" &&
                                typeof right === "object" &&
                                rfc9535Equals(left, right)));
                    default: {
                        const val = this.evalAst(node, currentValue, rootValue);
                        return val !== NOTHING && Boolean(val);
                    }
                }
            }
            case "member": {
                if (node.object.type === "current") {
                    if (currentValue === null || currentValue === undefined) {
                        return false;
                    }
                    if (typeof currentValue === "object") {
                        return Array.isArray(currentValue)
                            ? node.property === "length"
                            : hasOwn(currentValue, node.property);
                    }
                    return typeof currentValue === "string" && node.property === "length";
                }
                return this.evalAst(node, currentValue, rootValue) !== NOTHING;
            }
            case "index":
            case "current":
            case "root":
                return this.evalAst(node, currentValue, rootValue) !== NOTHING;
            case "call": {
                if (node.name === "match" || node.name === "search") {
                    return this.evalCall(node, currentValue, rootValue) === true;
                }
                const val = this.evalCall(node, currentValue, rootValue);
                return val !== NOTHING && Boolean(val);
            }
            case "literal":
                return Boolean(node.value);
            case "identifier":
                return false;
        }
    }
    static evalNodesArg(arg, currentValue, rootValue) {
        if (arg.type === "query") {
            return this.evalQueryNodelist(arg, currentValue, rootValue);
        }
        const val = this.evalAst(arg, currentValue, rootValue);
        return val === NOTHING ? [] : [val];
    }
    static evalCall(node, currentValue, rootValue) {
        switch (node.name) {
            case "length": {
                const val = this.evalAst(node.args[0], currentValue, rootValue);
                return lengthValue(val);
            }
            case "count": {
                return this.evalNodesArg(node.args[0], currentValue, rootValue).length;
            }
            case "value": {
                const nodes = this.evalNodesArg(node.args[0], currentValue, rootValue);
                return nodes.length === 1 ? nodes[0] : NOTHING;
            }
            case "match":
            case "search": {
                const str = this.evalAst(node.args[0], currentValue, rootValue);
                if (typeof str !== "string") {
                    return false;
                }
                let regex = node.compiledRegex;
                if (regex === undefined) {
                    const pat = this.evalAst(node.args[1], currentValue, rootValue);
                    if (typeof pat !== "string") {
                        return false;
                    }
                    regex = compileIRegexp(pat, node.name === "match");
                }
                return regex !== null && regex.test(str);
            }
            default:
                return NOTHING;
        }
    }
    static evalAst(node, currentValue, rootValue) {
        switch (node.type) {
            case "literal":
                return node.value;
            case "current":
                return currentValue === undefined ? NOTHING : currentValue;
            case "root":
                return rootValue === undefined ? NOTHING : rootValue;
            case "query": {
                const nodes = this.evalQueryNodelist(node, currentValue, rootValue);
                return nodes.length === 0 ? NOTHING : nodes[0];
            }
            case "call":
                return this.evalCall(node, currentValue, rootValue);
            case "identifier":
                return NOTHING;
            case "member": {
                const obj = node.object.type === "current"
                    ? currentValue
                    : node.object.type === "root"
                        ? rootValue
                        : this.evalAst(node.object, currentValue, rootValue);
                if (obj === null || obj === undefined || obj === NOTHING) {
                    return NOTHING;
                }
                if (typeof obj === "object") {
                    if (Array.isArray(obj)) {
                        return node.property === "length" ? obj.length : NOTHING;
                    }
                    return hasOwn(obj, node.property) ? obj[node.property] : NOTHING;
                }
                return typeof obj === "string" && node.property === "length"
                    ? obj.length
                    : NOTHING;
            }
            case "index": {
                const obj = node.object.type === "current"
                    ? currentValue
                    : node.object.type === "root"
                        ? rootValue
                        : this.evalAst(node.object, currentValue, rootValue);
                if (obj === null || obj === undefined || obj === NOTHING || typeof obj !== "object") {
                    return NOTHING;
                }
                const key = node.index.type === "literal"
                    ? node.index.value
                    : this.evalAst(node.index, currentValue, rootValue);
                if (key === NOTHING) {
                    return NOTHING;
                }
                if (Array.isArray(obj)) {
                    if (typeof key !== "number" || !Number.isInteger(key)) {
                        return NOTHING;
                    }
                    const idx = key < 0 ? obj.length + key : key;
                    return idx >= 0 && idx < obj.length ? obj[idx] : NOTHING;
                }
                if (typeof key === "string") {
                    return hasOwn(obj, key) ? obj[key] : NOTHING;
                }
                return NOTHING;
            }
            case "unary": {
                if (node.op === "!") {
                    return !this.evalFilterAst(node.argument, currentValue, rootValue);
                }
                const val = this.evalAst(node.argument, currentValue, rootValue);
                if (val === NOTHING) {
                    return NaN;
                }
                return node.op === "-" ? -Number(val) : +Number(val);
            }
            case "logical": {
                const left = this.evalAst(node.left, currentValue, rootValue);
                if (node.op === "&&") {
                    return left !== NOTHING && left
                        ? this.evalAst(node.right, currentValue, rootValue)
                        : left;
                }
                return left !== NOTHING && left
                    ? left
                    : this.evalAst(node.right, currentValue, rootValue);
            }
            case "binary": {
                const left = node.left.type === "literal"
                    ? node.left.value
                    : this.evalAst(node.left, currentValue, rootValue);
                const right = node.right.type === "literal"
                    ? node.right.value
                    : this.evalAst(node.right, currentValue, rootValue);
                switch (node.op) {
                    case "===":
                    case "!==":
                    case "==":
                    case "!=":
                    case ">":
                    case ">=":
                    case "<":
                    case "<=":
                        return this.evalComparison(node.op, left, right);
                    case "+":
                        return left === NOTHING || right === NOTHING ? NaN : left + right;
                    case "-":
                        return left === NOTHING || right === NOTHING ? NaN : left - right;
                    case "*":
                        return left === NOTHING || right === NOTHING ? NaN : left * right;
                    case "/":
                        return left === NOTHING || right === NOTHING ? NaN : left / right;
                    case "%":
                        return left === NOTHING || right === NOTHING ? NaN : left % right;
                }
            }
        }
    }
    static usesContext(node) {
        switch (node.type) {
            case "current":
            case "root":
            case "query":
            case "identifier":
                return true;
            case "literal":
                return false;
            case "call": {
                for (let i = 0; i < node.args.length; i++) {
                    if (this.usesContext(node.args[i]))
                        return true;
                }
                return false;
            }
            case "member":
                return this.usesContext(node.object);
            case "index":
                return this.usesContext(node.object) || this.usesContext(node.index);
            case "unary":
                return this.usesContext(node.argument);
            case "logical":
            case "binary":
                return this.usesContext(node.left) || this.usesContext(node.right);
        }
    }
    static usesRoot(node) {
        switch (node.type) {
            case "root":
                return true;
            case "query": {
                if (node.isRoot) {
                    return true;
                }
                const hooks = this.getQueryHooks();
                if (hooks.collectNestedFilterAsts) {
                    const nested = [];
                    hooks.collectNestedFilterAsts(node.steps, nested);
                    for (let i = 0; i < nested.length; i++) {
                        if (this.usesRoot(nested[i])) {
                            return true;
                        }
                    }
                }
                return false;
            }
            case "call": {
                for (let i = 0; i < node.args.length; i++) {
                    if (this.usesRoot(node.args[i]))
                        return true;
                }
                return false;
            }
            case "literal":
            case "current":
            case "identifier":
                return false;
            case "member":
                return this.usesRoot(node.object);
            case "index":
                return this.usesRoot(node.object) || this.usesRoot(node.index);
            case "unary":
                return this.usesRoot(node.argument);
            case "logical":
            case "binary":
                return this.usesRoot(node.left) || this.usesRoot(node.right);
        }
    }
    /**
     * Detects simple `@.length - k` (where k is a positive integer) so array
     * script selectors like `(@.length-1)` can run in O(k) memory.
     */
    static extractLengthOffset(node) {
        if (node.type === "binary" &&
            node.op === "-" &&
            node.left.type === "member" &&
            node.left.object.type === "current" &&
            node.left.property === "length" &&
            node.right.type === "literal" &&
            typeof node.right.value === "number" &&
            Number.isInteger(node.right.value) &&
            node.right.value > 0) {
            return node.right.value;
        }
        return null;
    }
    static evaluateFilter(expr, currentValue, rootValue) {
        const ast = this.compile(expr);
        return this.evalFilterAst(ast, currentValue, rootValue);
    }
    static evaluateScript(expr, currentValue, rootValue) {
        const ast = this.compile(expr);
        return this.evalAst(ast, currentValue, rootValue);
    }
    static staticEval(value) {
        const trimmed = value.trim();
        if (trimmed === "true" || trimmed === "false" || trimmed === "null") {
            return trimmed;
        }
        if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
            return String(Number(trimmed));
        }
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        // Simple arithmetic expression (numbers and +, -, *, /, %, parentheses)
        if (/^[0-9+\-*/%().\s]+$/.test(trimmed)) {
            try {
                const ast = this.compile(trimmed);
                if (!this.usesContext(ast)) {
                    const result = this.evalAst(ast, undefined);
                    if (result !== undefined && typeof result !== "function") {
                        return String(result);
                    }
                }
            }
            catch {
                return value;
            }
        }
        return value;
    }
}
ConditionEval.astCache = new Map();
ConditionEval.queryHooks = null;
