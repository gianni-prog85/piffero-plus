import {
  ConditionEval,
  ExprNode,
  decodeJsonPathStringInner,
} from "../conditioneval/conditioneval";
import { SaxHandler } from "../libs/clarinet/cstream";

export type JsonPathStep =
  | { kind: "child"; key: string; recursive?: boolean }
  | { kind: "wildcard"; recursive?: boolean }
  | { kind: "index"; indexes: Set<number>; rawIndexes: number[]; recursive?: boolean }
  | { kind: "slice"; start?: number; end?: number; step: number; recursive?: boolean }
  | { kind: "unionKeys"; keys: Set<string>; orderedKeys: string[]; recursive?: boolean }
  | { kind: "filter"; expr: string; ast: ExprNode; recursive?: boolean }
  | {
      kind: "script";
      expr: string;
      ast: ExprNode;
      staticIndex?: number;
      lengthOffset?: number | null;
      recursive?: boolean;
    }
  | { kind: "union"; selectors: JsonPathStep[]; recursive?: boolean };

export interface LegacyCondition {
  key: string;
  value: string;
}

export interface LegacyParsedPath {
  value: string;
  range?: { start?: number; end?: number; step?: number };
  indexes?: Set<number>;
  isbulk: boolean;
  condition?: LegacyCondition;
  next: LegacyParsedPath;
  hascondtion: boolean;
  recursiveDescendant: boolean;
  steps?: JsonPathStep[];
  needsStreamingEngine?: boolean;
}

export const PATH_ERROR_MESSAGE = "Invalid json path";

export class PifferoJsonPathError extends Error {}

function isMemberNameFirst(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5A) ||
    (cp >= 0x61 && cp <= 0x7A) ||
    cp === 0x5F ||
    (cp >= 0x80 && cp <= 0xD7FF) ||
    (cp >= 0xE000 && cp <= 0x10FFFF)
  );
}

function isMemberNameChar(cp: number): boolean {
  return isMemberNameFirst(cp) || (cp >= 0x30 && cp <= 0x39);
}

function parseIJsonInt(raw: string, fullPath: string): number {
  if (!/^(?:0|-?[1-9]\d*)$/.test(raw)) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num)) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }
  return num;
}

function findMatchingBracket(
  str: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let i = openIndex;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      let closed = false;
      while (i < str.length) {
        if (str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === quote) {
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
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function splitOutsideQuotes(
  str: string,
  delimiter: string,
  fullPath?: string
): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      let closed = false;
      while (i < str.length) {
        if (str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed && fullPath !== undefined) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
      }
      continue;
    }
    if (ch === "(") {
      parenDepth++;
    } else if (ch === ")") {
      parenDepth--;
      if (parenDepth < 0 && fullPath !== undefined) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
      }
    } else if (ch === "[") {
      bracketDepth++;
    } else if (ch === "]") {
      bracketDepth--;
      if (bracketDepth < 0 && fullPath !== undefined) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
      }
    } else if (ch === delimiter && parenDepth === 0 && bracketDepth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  if ((parenDepth !== 0 || bracketDepth !== 0) && fullPath !== undefined) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }
  parts.push(str.slice(start));
  return parts;
}

function tryUnquoteString(raw: string, fullPath: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return null;
  }
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  // Ensure the closing quote is actually the matching one for index 0
  let i = 1;
  while (i < trimmed.length - 1) {
    if (trimmed[i] === "\\") {
      i += 2;
      continue;
    }
    if (trimmed[i] === quote) {
      return null;
    }
    i++;
  }
  if (i !== trimmed.length - 1) {
    return null;
  }
  try {
    return decodeJsonPathStringInner(trimmed.slice(1, -1), quote);
  } catch {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }
}

function parseSingleSelector(
  sel: string,
  recursive: boolean,
  fullPath: string
): JsonPathStep {
  if (sel.length === 0) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }

  if (sel === "*") {
    return { kind: "wildcard", recursive };
  }

  // Filter expression: ?expr or ?(expr) (RFC 9535 §2.3.5)
  if (sel.startsWith("?")) {
    let expr = sel.slice(1).trim();
    if (!expr) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    if (
      expr.startsWith("(") &&
      findMatchingBracket(expr, 0, "(", ")") === expr.length - 1
    ) {
      expr = expr.slice(1, -1).trim();
      if (!expr) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
      }
    }
    try {
      const ast = ConditionEval.compile(expr);
      return { kind: "filter", expr, ast, recursive };
    } catch {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
  }

  // Script expression: (...)
  if (sel.startsWith("(")) {
    const closeParen = findMatchingBracket(sel, 0, "(", ")");
    if (closeParen !== sel.length - 1) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const expr = sel.slice(1, -1).trim();
    if (!expr) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    try {
      const ast = ConditionEval.compile(expr);
      let staticIndex: number | undefined;
      if (!ConditionEval.usesContext(ast)) {
        const val = ConditionEval.evalAst(ast, undefined);
        if (typeof val === "number" && Number.isInteger(val)) {
          staticIndex = val;
        }
      }
      const lengthOffset = ConditionEval.extractLengthOffset(ast);
      return {
        kind: "script",
        expr,
        ast,
        staticIndex,
        lengthOffset,
        recursive,
      };
    } catch {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
  }

  // Quoted property name
  if (sel[0] === "'" || sel[0] === '"') {
    const unquoted = tryUnquoteString(sel, fullPath);
    if (unquoted !== null) {
      return { kind: "child", key: unquoted, recursive };
    }
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }

  // Slice [start:end] or [start:end:step]
  const colonParts = splitOutsideQuotes(sel, ":", fullPath);
  if (colonParts.length > 1) {
    if (colonParts.length > 3) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    const [startRaw, endRaw, stepRaw] = colonParts.map((s) => s.trim());
    const start = startRaw === "" ? undefined : parseIJsonInt(startRaw, fullPath);
    const end = endRaw === "" ? undefined : parseIJsonInt(endRaw, fullPath);
    const step =
      stepRaw === undefined || stepRaw === "" ? 1 : parseIJsonInt(stepRaw, fullPath);
    return { kind: "slice", start, end, step, recursive };
  }

  // Single integer index
  if (/^-?\d+$/.test(sel)) {
    const num = parseIJsonInt(sel, fullPath);
    return {
      kind: "index",
      indexes: new Set([num]),
      rawIndexes: [num],
      recursive,
    };
  }

  throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
}

function parseBracketSubscript(
  inner: string,
  recursive: boolean,
  fullPath: string
): JsonPathStep {
  if (inner.length === 0) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
  }

  const commaParts = splitOutsideQuotes(inner, ",", fullPath);
  if (commaParts.length === 1) {
    return parseSingleSelector(commaParts[0].trim(), recursive, fullPath);
  }

  const selectors: JsonPathStep[] = [];
  for (let i = 0; i < commaParts.length; i++) {
    const trimmed = commaParts[i].trim();
    if (trimmed.length === 0) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${fullPath}`);
    }
    selectors.push(parseSingleSelector(trimmed, false, fullPath));
  }

  // Fast-path 1: Distinct string-key union
  if (selectors.every((s) => s.kind === "child")) {
    const orderedKeys = selectors.map(
      (s) => (s as Extract<JsonPathStep, { kind: "child" }>).key
    );
    const keySet = new Set(orderedKeys);
    if (keySet.size === orderedKeys.length) {
      return { kind: "unionKeys", keys: keySet, orderedKeys, recursive };
    }
    return { kind: "union", selectors, recursive };
  }

  // Fast-path 2: Strictly increasing non-negative integer union (preserves streaming O(1) lookup)
  if (selectors.every((s) => s.kind === "index")) {
    const nums = selectors.map(
      (s) => (s as Extract<JsonPathStep, { kind: "index" }>).rawIndexes[0]
    );
    let strictlyIncreasingNonNeg = nums[0] >= 0;
    for (let i = 1; i < nums.length && strictlyIncreasingNonNeg; i++) {
      if (nums[i] < 0 || nums[i] <= nums[i - 1]) {
        strictlyIncreasingNonNeg = false;
      }
    }
    if (strictlyIncreasingNonNeg) {
      return {
        kind: "index",
        indexes: new Set(nums),
        rawIndexes: nums,
        recursive,
      };
    }
  }

  return { kind: "union", selectors, recursive };
}

export function tokenizeJsonPath(jsonPath: string): JsonPathStep[] {
  if (!jsonPath || !jsonPath.startsWith("$")) {
    throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
  }
  const steps: JsonPathStep[] = [];
  let i = 1;
  const len = jsonPath.length;

  while (i < len) {
    let recursive = false;
    if (jsonPath[i] === ".") {
      if (i + 1 < len && jsonPath[i + 1] === ".") {
        recursive = true;
        i += 2;
        if (i >= len || jsonPath[i] === ".") {
          throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
        }
      } else {
        i += 1;
        if (i >= len || jsonPath[i] === ".") {
          throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
        }
      }
    } else if (jsonPath[i] !== "[") {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
    }

    if (jsonPath[i] === "[") {
      const closeIdx = findMatchingBracket(jsonPath, i, "[", "]");
      if (closeIdx === -1) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      const inner = jsonPath.slice(i + 1, closeIdx).trim();
      i = closeIdx + 1;
      steps.push(parseBracketSubscript(inner, recursive, jsonPath));
      continue;
    }

    if (jsonPath[i] === "*") {
      i++;
      if (i < len && jsonPath[i] !== "." && jsonPath[i] !== "[") {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      steps.push({ kind: "wildcard", recursive });
      continue;
    }

    // Read member-name-shorthand (RFC 9535 §2.5.1.1) up to '.' or '['
    const start = i;
    const firstCp = jsonPath.codePointAt(i);
    if (firstCp === undefined || !isMemberNameFirst(firstCp)) {
      throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
    }
    i += firstCp > 0xFFFF ? 2 : 1;
    while (i < len && jsonPath[i] !== "." && jsonPath[i] !== "[") {
      const cp = jsonPath.codePointAt(i);
      if (cp === undefined || !isMemberNameChar(cp)) {
        throw new PifferoJsonPathError(`${PATH_ERROR_MESSAGE}: ${jsonPath}`);
      }
      i += cp > 0xFFFF ? 2 : 1;
    }
    const key = jsonPath.slice(start, i);
    steps.push({ kind: "child", key, recursive });
  }

  return steps;
}

function tryExtractSimpleCondition(ast: ExprNode): LegacyCondition | null {
  if (
    ast.type === "binary" &&
    (ast.op === "===" || ast.op === "==") &&
    ast.left.type === "member" &&
    ast.left.object.type === "current" &&
    !ConditionEval.usesContext(ast.right)
  ) {
    const val = ConditionEval.evalAst(ast.right, undefined);
    if (
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean" ||
      val === null
    ) {
      return {
        key: JSON.stringify(ast.left.property),
        value: typeof val === "string" ? JSON.stringify(val) : String(val),
      };
    }
  }
  return null;
}

export function buildLegacyAndDetermineEngine(
  jsonPath: string,
  steps: JsonPathStep[]
): LegacyParsedPath {
  const root: LegacyParsedPath = {
    value: '"$"',
    next: null,
    isbulk: false,
    recursiveDescendant: false,
    hascondtion: false,
    steps,
    needsStreamingEngine: false,
  };

  let current = root;
  let needsStreamingEngine = false;

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const hasNext = idx + 1 < steps.length;

    if (step.recursive) {
      needsStreamingEngine = true;
    }

    if (
      step.kind === "wildcard" ||
      step.kind === "script" ||
      step.kind === "unionKeys" ||
      step.kind === "union"
    ) {
      needsStreamingEngine = true;
      const node: LegacyParsedPath = {
        value: step.kind === "wildcard" ? '"*"' : '""',
        next: null,
        isbulk: true,
        recursiveDescendant: Boolean(step.recursive),
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    if (step.kind === "child" && !step.recursive) {
      const node: LegacyParsedPath = {
        value: JSON.stringify(step.key),
        next: null,
        isbulk: false,
        recursiveDescendant: false,
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    if (step.kind === "child" && step.recursive) {
      const node: LegacyParsedPath = {
        value: JSON.stringify(step.key),
        next: null,
        isbulk: true,
        recursiveDescendant: true,
        hascondtion: false,
      };
      current.next = node;
      current = node;
      continue;
    }

    // Subscript step: index, slice, or filter
    const canAttachToCurrent =
      !step.recursive &&
      !current.isbulk &&
      !current.hascondtion &&
      !current.range &&
      !current.indexes;

    if (step.kind === "index") {
      const hasNegative = step.rawIndexes.some((n) => n < 0);
      const isMulti = step.rawIndexes.length > 1;
      if (
        hasNegative ||
        (isMulti && (hasNext || current.value === '"$"')) ||
        !canAttachToCurrent
      ) {
        needsStreamingEngine = true;
      }
      const range = {
        start: step.rawIndexes[0],
        ...(isMulti ? {} : { step: 1 }),
      };
      if (canAttachToCurrent) {
        current.isbulk = true;
        current.range = range;
        current.indexes = new Set(step.indexes);
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: true,
          range,
          indexes: new Set(step.indexes),
          recursiveDescendant: Boolean(step.recursive),
          hascondtion: false,
        };
        current.next = node;
        current = node;
      }
      continue;
    }

    if (step.kind === "slice") {
      needsStreamingEngine = true;
      const range = {
        start: step.start !== undefined ? step.start : 0,
        ...(step.end !== undefined ? { end: step.end } : {}),
        step: step.step,
      };
      if (canAttachToCurrent) {
        current.isbulk = true;
        current.range = range;
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: true,
          range,
          recursiveDescendant: Boolean(step.recursive),
          hascondtion: false,
        };
        current.next = node;
        current = node;
      }
      continue;
    }

    if (step.kind === "filter") {
      const simpleCond = tryExtractSimpleCondition(step.ast);
      const remainingSteps = steps.slice(idx + 1);
      const onlySimplePostChild = remainingSteps.every(
        (s) =>
          !s.recursive &&
          (s.kind === "child" ||
            (s.kind === "index" && s.rawIndexes.every((n) => n >= 0)) ||
            (s.kind === "slice" &&
              s.step > 0 &&
              (s.start === undefined || s.start >= 0) &&
              (s.end === undefined || s.end >= 0)))
      );
      if (
        !simpleCond ||
        current.value === '"$"' ||
        !canAttachToCurrent ||
        !onlySimplePostChild
      ) {
        needsStreamingEngine = true;
      }
      if (canAttachToCurrent) {
        current.condition = simpleCond || { key: '""', value: '""' };
        current.hascondtion = true;
      } else {
        const node: LegacyParsedPath = {
          value: '""',
          next: null,
          isbulk: false,
          condition: simpleCond || { key: '""', value: '""' },
          hascondtion: true,
          recursiveDescendant: Boolean(step.recursive),
        };
        current.next = node;
        current = node;
      }
      continue;
    }
  }

  root.needsStreamingEngine = needsStreamingEngine;
  return root;
}

// ---------- In-memory evaluation for post-filter / post-script subtrees ----------

function resolveSliceBounds(
  length: number,
  start?: number,
  end?: number,
  step = 1
): { lower: number; upper: number } {
  const nStart = start !== undefined ? start : step >= 0 ? 0 : length - 1;
  const nEnd = end !== undefined ? end : step >= 0 ? length : -length - 1;
  const normStart = nStart >= 0 ? nStart : length + nStart;
  const normEnd = nEnd >= 0 ? nEnd : length + nEnd;

  if (step >= 0) {
    return {
      lower: Math.min(Math.max(normStart, 0), length),
      upper: Math.min(Math.max(normEnd, 0), length),
    };
  }
  return {
    upper: Math.min(Math.max(normStart, -1), length - 1),
    lower: Math.min(Math.max(normEnd, -1), length - 1),
  };
}

export type ResultType = "value" | "path" | "pointer" | "all";

function escapeNormalizedKey(key: string): string {
  let needsEscape = false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x20 || code === 0x27 || code === 0x5c) {
      needsEscape = true;
      break;
    }
  }
  if (!needsEscape) {
    return key;
  }
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    switch (code) {
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      case 0x27:
        out += "\\'";
        break;
      case 0x5c:
        out += "\\\\";
        break;
      default:
        if (code < 0x20) {
          out += "\\u00" + code.toString(16).padStart(2, "0");
        } else {
          out += key[i];
        }
        break;
    }
  }
  return out;
}

/**
 * Formats path segments as a canonical RFC 9535 §2.7 Normalized Path
 * (e.g. `$['employees'][0]['name']`).
 */
export function formatNormalizedPath(
  segments: ReadonlyArray<string | number>
): string {
  let out = "$";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      out += `['${escapeNormalizedKey(seg)}']`;
    }
  }
  return out;
}

/**
 * Formats path segments as an RFC 6901 JSON Pointer
 * (e.g. `/employees/0/name`, or `""` for the root document).
 */
export function formatJsonPointer(
  segments: ReadonlyArray<string | number>
): string {
  if (segments.length === 0) {
    return "";
  }
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const raw = String(segments[i]);
    if (raw.indexOf("~") === -1 && raw.indexOf("/") === -1) {
      out += "/" + raw;
    } else {
      out += "/" + raw.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
  return out;
}

function formatResultPayload(
  resultType: ResultType,
  segments: ReadonlyArray<string | number>,
  rawValueJson?: string
): string {
  switch (resultType) {
    case "path":
      return JSON.stringify(formatNormalizedPath(segments));
    case "pointer":
      return JSON.stringify(formatJsonPointer(segments));
    case "all": {
      const pathJson = JSON.stringify(formatNormalizedPath(segments));
      const ptrJson = JSON.stringify(formatJsonPointer(segments));
      return `{"path":${pathJson},"pointer":${ptrJson},"value":${rawValueJson}}`;
    }
    default:
      return rawValueJson as string;
  }
}

export function evaluateStepsOnValue(
  val: any,
  steps: JsonPathStep[],
  stepIndex: number,
  rootValue?: any
): any[] {
  if (stepIndex >= steps.length) {
    return [val];
  }
  const step = steps[stepIndex];
  const results: any[] = [];

  if (step.recursive) {
    const nonRecStep: JsonPathStep = { ...step, recursive: false };
    results.push(
      ...evaluateSingleStepOnValue(val, nonRecStep, steps, stepIndex + 1, rootValue)
    );
    if (val !== null && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(...evaluateStepsOnValue(val[i], steps, stepIndex, rootValue));
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          results.push(
            ...evaluateStepsOnValue(val[keys[i]], steps, stepIndex, rootValue)
          );
        }
      }
    }
    return results;
  }

  return evaluateSingleStepOnValue(val, step, steps, stepIndex + 1, rootValue);
}

function evaluateSingleStepOnValue(
  val: any,
  step: JsonPathStep,
  steps: JsonPathStep[],
  nextIndex: number,
  rootValue?: any
): any[] {
  const results: any[] = [];
  if (val === null || val === undefined || typeof val !== "object") {
    return results;
  }

  switch (step.kind) {
    case "child": {
      if (!Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, step.key)) {
        results.push(
          ...evaluateStepsOnValue(val[step.key], steps, nextIndex, rootValue)
        );
      }
      break;
    }
    case "unionKeys": {
      if (!Array.isArray(val)) {
        for (let i = 0; i < step.orderedKeys.length; i++) {
          const k = step.orderedKeys[i];
          if (Object.prototype.hasOwnProperty.call(val, k)) {
            results.push(
              ...evaluateStepsOnValue(val[k], steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "wildcard": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          results.push(
            ...evaluateStepsOnValue(val[keys[i]], steps, nextIndex, rootValue)
          );
        }
      }
      break;
    }
    case "index": {
      if (Array.isArray(val)) {
        for (let i = 0; i < step.rawIndexes.length; i++) {
          const rawIdx = step.rawIndexes[i];
          const resolved = rawIdx < 0 ? val.length + rawIdx : rawIdx;
          if (resolved >= 0 && resolved < val.length) {
            results.push(
              ...evaluateStepsOnValue(val[resolved], steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "slice": {
      if (Array.isArray(val) && step.step !== 0) {
        const { lower, upper } = resolveSliceBounds(
          val.length,
          step.start,
          step.end,
          step.step
        );
        if (step.step > 0) {
          for (let i = lower; i < upper; i += step.step) {
            results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
          }
        } else {
          for (let i = upper; i > lower; i += step.step) {
            results.push(...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue));
          }
        }
      }
      break;
    }
    case "filter": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (ConditionEval.evalFilterAst(step.ast, val[i], rootValue)) {
            results.push(
              ...evaluateStepsOnValue(val[i], steps, nextIndex, rootValue)
            );
          }
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          const child = val[keys[i]];
          if (ConditionEval.evalFilterAst(step.ast, child, rootValue)) {
            results.push(
              ...evaluateStepsOnValue(child, steps, nextIndex, rootValue)
            );
          }
        }
      }
      break;
    }
    case "script": {
      if (Array.isArray(val)) {
        const computed =
          step.staticIndex !== undefined
            ? step.staticIndex
            : ConditionEval.evalAst(step.ast, val, rootValue);
        if (
          typeof computed === "number" &&
          Number.isInteger(computed) &&
          computed >= 0 &&
          computed < val.length
        ) {
          results.push(
            ...evaluateStepsOnValue(val[computed], steps, nextIndex, rootValue)
          );
        }
      }
      break;
    }
    case "union": {
      for (let i = 0; i < step.selectors.length; i++) {
        results.push(
          ...evaluateSingleStepOnValue(
            val,
            step.selectors[i],
            steps,
            nextIndex,
            rootValue
          )
        );
      }
      break;
    }
  }
  return results;
}

export interface EvaluatedPathResult {
  value: any;
  path: Array<string | number>;
}

export function evaluateStepsWithPaths(
  val: any,
  steps: JsonPathStep[],
  stepIndex: number,
  rootValue: any,
  basePath: Array<string | number>
): EvaluatedPathResult[] {
  if (stepIndex >= steps.length) {
    return [{ value: val, path: basePath }];
  }
  const step = steps[stepIndex];
  const results: EvaluatedPathResult[] = [];

  if (step.recursive) {
    const nonRecStep: JsonPathStep = { ...step, recursive: false };
    results.push(
      ...evaluateSingleStepWithPaths(
        val,
        nonRecStep,
        steps,
        stepIndex + 1,
        rootValue,
        basePath
      )
    );
    if (val !== null && typeof val === "object") {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(
            ...evaluateStepsWithPaths(
              val[i],
              steps,
              stepIndex,
              rootValue,
              [...basePath, i]
            )
          );
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          results.push(
            ...evaluateStepsWithPaths(
              val[k],
              steps,
              stepIndex,
              rootValue,
              [...basePath, k]
            )
          );
        }
      }
    }
    return results;
  }

  return evaluateSingleStepWithPaths(
    val,
    step,
    steps,
    stepIndex + 1,
    rootValue,
    basePath
  );
}

function evaluateSingleStepWithPaths(
  val: any,
  step: JsonPathStep,
  steps: JsonPathStep[],
  nextIndex: number,
  rootValue: any,
  basePath: Array<string | number>
): EvaluatedPathResult[] {
  const results: EvaluatedPathResult[] = [];
  if (val === null || val === undefined || typeof val !== "object") {
    return results;
  }

  switch (step.kind) {
    case "child": {
      if (!Array.isArray(val) && Object.prototype.hasOwnProperty.call(val, step.key)) {
        results.push(
          ...evaluateStepsWithPaths(
            val[step.key],
            steps,
            nextIndex,
            rootValue,
            [...basePath, step.key]
          )
        );
      }
      break;
    }
    case "unionKeys": {
      if (!Array.isArray(val)) {
        for (let i = 0; i < step.orderedKeys.length; i++) {
          const k = step.orderedKeys[i];
          if (Object.prototype.hasOwnProperty.call(val, k)) {
            results.push(
              ...evaluateStepsWithPaths(
                val[k],
                steps,
                nextIndex,
                rootValue,
                [...basePath, k]
              )
            );
          }
        }
      }
      break;
    }
    case "wildcard": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          results.push(
            ...evaluateStepsWithPaths(
              val[i],
              steps,
              nextIndex,
              rootValue,
              [...basePath, i]
            )
          );
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          results.push(
            ...evaluateStepsWithPaths(
              val[k],
              steps,
              nextIndex,
              rootValue,
              [...basePath, k]
            )
          );
        }
      }
      break;
    }
    case "index": {
      if (Array.isArray(val)) {
        for (let i = 0; i < step.rawIndexes.length; i++) {
          const rawIdx = step.rawIndexes[i];
          const resolved = rawIdx < 0 ? val.length + rawIdx : rawIdx;
          if (resolved >= 0 && resolved < val.length) {
            results.push(
              ...evaluateStepsWithPaths(
                val[resolved],
                steps,
                nextIndex,
                rootValue,
                [...basePath, resolved]
              )
            );
          }
        }
      }
      break;
    }
    case "slice": {
      if (Array.isArray(val) && step.step !== 0) {
        const { lower, upper } = resolveSliceBounds(
          val.length,
          step.start,
          step.end,
          step.step
        );
        if (step.step > 0) {
          for (let i = lower; i < upper; i += step.step) {
            results.push(
              ...evaluateStepsWithPaths(
                val[i],
                steps,
                nextIndex,
                rootValue,
                [...basePath, i]
              )
            );
          }
        } else {
          for (let i = upper; i > lower; i += step.step) {
            results.push(
              ...evaluateStepsWithPaths(
                val[i],
                steps,
                nextIndex,
                rootValue,
                [...basePath, i]
              )
            );
          }
        }
      }
      break;
    }
    case "filter": {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (ConditionEval.evalFilterAst(step.ast, val[i], rootValue)) {
            results.push(
              ...evaluateStepsWithPaths(
                val[i],
                steps,
                nextIndex,
                rootValue,
                [...basePath, i]
              )
            );
          }
        }
      } else {
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const child = val[k];
          if (ConditionEval.evalFilterAst(step.ast, child, rootValue)) {
            results.push(
              ...evaluateStepsWithPaths(
                child,
                steps,
                nextIndex,
                rootValue,
                [...basePath, k]
              )
            );
          }
        }
      }
      break;
    }
    case "script": {
      if (Array.isArray(val)) {
        const computed =
          step.staticIndex !== undefined
            ? step.staticIndex
            : ConditionEval.evalAst(step.ast, val, rootValue);
        if (
          typeof computed === "number" &&
          Number.isInteger(computed) &&
          computed >= 0 &&
          computed < val.length
        ) {
          results.push(
            ...evaluateStepsWithPaths(
              val[computed],
              steps,
              nextIndex,
              rootValue,
              [...basePath, computed]
            )
          );
        }
      }
      break;
    }
    case "union": {
      for (let i = 0; i < step.selectors.length; i++) {
        results.push(
          ...evaluateSingleStepWithPaths(
            val,
            step.selectors[i],
            steps,
            nextIndex,
            rootValue,
            basePath
          )
        );
      }
      break;
    }
  }
  return results;
}

function collectNestedFilterAsts(steps: JsonPathStep[], out: ExprNode[]) {
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.kind === "filter" || st.kind === "script") {
      out.push(st.ast);
    } else if (st.kind === "union") {
      for (let s = 0; s < st.selectors.length; s++) {
        const sel = st.selectors[s];
        if (sel.kind === "filter" || sel.kind === "script") {
          out.push(sel.ast);
        }
      }
    }
  }
}

ConditionEval.registerQueryHooks({
  compileQuery: tokenizeJsonPath,
  evaluateSteps: evaluateStepsOnValue,
  collectNestedFilterAsts,
});

// ---------- Streaming SAX JSONPath Engine ----------

interface CaptureStackEntry {
  type: "object" | "array";
  hasItem: boolean;
}

class JsonValueCollector {
  private stack: CaptureStackEntry[] = [];
  chunks: string[] = [];
  done = false;

  constructor(private onToken?: (token: string) => void) {}

  private emit(token: string) {
    if (this.onToken) {
      this.onToken(token);
    } else {
      this.chunks.push(token);
    }
  }

  openObject(keyNode?: string) {
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      if (parent.type === "array" && parent.hasItem) {
        this.emit(keyNode !== undefined ? `,{${keyNode}:` : ",{");
      } else {
        this.emit(keyNode !== undefined ? `{${keyNode}:` : "{");
      }
      parent.hasItem = true;
    } else {
      this.emit(keyNode !== undefined ? `{${keyNode}:` : "{");
    }
    this.stack.push({ type: "object", hasItem: keyNode !== undefined });
  }

  closeObject() {
    this.stack.pop();
    this.emit("}");
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  openArray() {
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      if (parent.type === "array" && parent.hasItem) {
        this.emit(",[");
      } else {
        this.emit("[");
      }
      parent.hasItem = true;
    } else {
      this.emit("[");
    }
    this.stack.push({ type: "array", hasItem: false });
  }

  closeArray() {
    this.stack.pop();
    this.emit("]");
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  key(keyNode: string) {
    const top = this.stack[this.stack.length - 1];
    if (top.hasItem) {
      this.emit(`,${keyNode}:`);
    } else {
      top.hasItem = true;
      this.emit(`${keyNode}:`);
    }
  }

  value(valNode: string) {
    const top = this.stack[this.stack.length - 1];
    if (top) {
      if (top.type === "array" && top.hasItem) {
        this.emit(`,${valNode}`);
      } else {
        top.hasItem = true;
        this.emit(valNode);
      }
    } else {
      this.emit(valNode);
      this.done = true;
    }
  }
}

// ---------- Pruned JS Object Builder for ?() filters with post-steps ----------

interface FilterProjectionNode {
  captureFull: boolean;
  usedAsTruthiness: boolean;
  children: Map<string, FilterProjectionNode>;
}

function createProjectionNode(): FilterProjectionNode {
  return {
    captureFull: false,
    usedAsTruthiness: false,
    children: new Map(),
  };
}

function getOrCreateChildProj(
  node: FilterProjectionNode,
  key: string
): FilterProjectionNode {
  let child = node.children.get(key);
  if (!child) {
    child = createProjectionNode();
    node.children.set(key, child);
  }
  return child;
}

function markProjectionPath(
  root: FilterProjectionNode,
  path: string[],
  asTruthiness: boolean
) {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    cur = getOrCreateChildProj(cur, path[i]);
  }
  if (asTruthiness) {
    cur.usedAsTruthiness = true;
  } else {
    cur.captureFull = true;
  }
}

function extractCurrentMemberChain(node: ExprNode): string[] | null {
  if (node.type === "current") {
    return [];
  }
  if (node.type === "member") {
    const base = extractCurrentMemberChain(node.object);
    if (base !== null) {
      base.push(node.property);
      return base;
    }
  } else if (
    node.type === "index" &&
    node.index.type === "literal" &&
    typeof node.index.value === "string"
  ) {
    const base = extractCurrentMemberChain(node.object);
    if (base !== null) {
      base.push(node.index.value);
      return base;
    }
  }
  return null;
}

function extractRootMemberChain(node: ExprNode): string[] | null {
  if (node.type === "root") {
    return [];
  }
  if (node.type === "member") {
    const base = extractRootMemberChain(node.object);
    if (base !== null) {
      base.push(node.property);
      return base;
    }
  } else if (
    node.type === "index" &&
    node.index.type === "literal" &&
    typeof node.index.value === "string"
  ) {
    const base = extractRootMemberChain(node.object);
    if (base !== null) {
      base.push(node.index.value);
      return base;
    }
  }
  return null;
}

function collectExprProjection(
  node: ExprNode,
  root: FilterProjectionNode,
  truthinessContext: boolean
): boolean {
  switch (node.type) {
    case "literal":
    case "identifier":
    case "root":
      return true;
    case "current":
      return false;
    case "query": {
      if (node.isRoot) {
        return true;
      }
      const steps = node.steps as JsonPathStep[];
      const staticPrefix: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        if (!st.recursive && st.kind === "child") {
          staticPrefix.push(st.key);
        } else {
          break;
        }
      }
      if (staticPrefix.length === 0) {
        return false;
      }
      const nested: ExprNode[] = [];
      collectNestedFilterAsts(steps, nested);
      for (let i = 0; i < nested.length; i++) {
        if (ConditionEval.usesRoot(nested[i])) {
          // Nested root filter inside current query is safe when full item is built
          return false;
        }
      }
      markProjectionPath(root, staticPrefix, false);
      return true;
    }
    case "member": {
      const chain = extractCurrentMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        // `.length` might read array/string length -> capture parent array/string in full
        if (chain[chain.length - 1] === "length") {
          if (chain.length === 1) return false;
          markProjectionPath(root, chain.slice(0, -1), false);
        } else {
          markProjectionPath(root, chain, truthinessContext);
        }
        return true;
      }
      if (extractRootMemberChain(node) !== null) {
        return true;
      }
      return collectExprProjection(node.object, root, false);
    }
    case "index": {
      if (!collectExprProjection(node.index, root, false)) {
        return false;
      }
      const chain = extractCurrentMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        markProjectionPath(root, chain, truthinessContext);
        return true;
      }
      const objChain = extractCurrentMemberChain(node.object);
      if (objChain !== null) {
        if (objChain.length === 0) return false;
        markProjectionPath(root, objChain, false);
        return true;
      }
      if (extractRootMemberChain(node) !== null) {
        return true;
      }
      return collectExprProjection(node.object, root, false);
    }
    case "unary":
      return collectExprProjection(
        node.argument,
        root,
        node.op === "!" ? true : false
      );
    case "logical":
      return (
        collectExprProjection(node.left, root, truthinessContext) &&
        collectExprProjection(node.right, root, truthinessContext)
      );
    case "binary":
      return (
        collectExprProjection(node.left, root, false) &&
        collectExprProjection(node.right, root, false)
      );
    case "call": {
      for (let i = 0; i < node.args.length; i++) {
        if (!collectExprProjection(node.args[i], root, false)) {
          return false;
        }
      }
      return true;
    }
  }
}

function collectRootProjection(
  node: ExprNode,
  rootProj: FilterProjectionNode,
  truthinessContext: boolean
): boolean {
  if (!ConditionEval.usesRoot(node)) {
    return true;
  }
  switch (node.type) {
    case "literal":
    case "identifier":
    case "current":
      return true;
    case "root":
      return false;
    case "query": {
      if (node.isRoot) {
        const steps = node.steps as JsonPathStep[];
        const staticPrefix: string[] = [];
        for (let i = 0; i < steps.length; i++) {
          const st = steps[i];
          if (!st.recursive && st.kind === "child") {
            staticPrefix.push(st.key);
          } else {
            break;
          }
        }
        if (staticPrefix.length === 0) {
          return false;
        }
        markProjectionPath(rootProj, staticPrefix, false);
      }
      const nested: ExprNode[] = [];
      collectNestedFilterAsts(node.steps as JsonPathStep[], nested);
      for (let i = 0; i < nested.length; i++) {
        if (!collectRootProjection(nested[i], rootProj, true)) {
          return false;
        }
      }
      return true;
    }
    case "member": {
      const chain = extractRootMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        if (chain[chain.length - 1] === "length") {
          if (chain.length === 1) return false;
          markProjectionPath(rootProj, chain.slice(0, -1), false);
        } else {
          markProjectionPath(rootProj, chain, truthinessContext);
        }
        return true;
      }
      return collectRootProjection(node.object, rootProj, false);
    }
    case "index": {
      if (!collectRootProjection(node.index, rootProj, false)) {
        return false;
      }
      const chain = extractRootMemberChain(node);
      if (chain !== null) {
        if (chain.length === 0) return false;
        markProjectionPath(rootProj, chain, truthinessContext);
        return true;
      }
      const objChain = extractRootMemberChain(node.object);
      if (objChain !== null) {
        if (objChain.length === 0) return false;
        markProjectionPath(rootProj, objChain, false);
        return true;
      }
      return collectRootProjection(node.object, rootProj, false);
    }
    case "unary":
      return collectRootProjection(
        node.argument,
        rootProj,
        node.op === "!" ? true : false
      );
    case "logical":
      return (
        collectRootProjection(node.left, rootProj, truthinessContext) &&
        collectRootProjection(node.right, rootProj, truthinessContext)
      );
    case "binary":
      return (
        collectRootProjection(node.left, rootProj, false) &&
        collectRootProjection(node.right, rootProj, false)
      );
    case "call": {
      for (let i = 0; i < node.args.length; i++) {
        if (!collectRootProjection(node.args[i], rootProj, false)) {
          return false;
        }
      }
      return true;
    }
  }
}

function buildRootProjection(
  steps: JsonPathStep[]
): FilterProjectionNode | null {
  const rootProj = createProjectionNode();
  const asts: ExprNode[] = [];
  collectNestedFilterAsts(steps, asts);
  let hasRootExpr = false;
  for (let i = 0; i < asts.length; i++) {
    if (ConditionEval.usesRoot(asts[i])) {
      hasRootExpr = true;
      if (!collectRootProjection(asts[i], rootProj, true)) {
        return null;
      }
    }
  }
  if (!hasRootExpr || rootProj.children.size === 0) {
    return null;
  }
  return rootProj;
}

function buildFilterProjection(
  ast: ExprNode,
  remainingSteps: JsonPathStep[]
): FilterProjectionNode | null {
  if (remainingSteps.length === 0) {
    return null;
  }
  const root = createProjectionNode();
  if (!collectExprProjection(ast, root, true)) {
    return null;
  }

  let cursors: FilterProjectionNode[] = [root];
  for (let i = 0; i < remainingSteps.length; i++) {
    const step = remainingSteps[i];
    if (step.recursive) {
      return null;
    }
    if (step.kind === "child") {
      const next: FilterProjectionNode[] = [];
      for (let c = 0; c < cursors.length; c++) {
        next.push(getOrCreateChildProj(cursors[c], step.key));
      }
      cursors = next;
    } else if (step.kind === "unionKeys") {
      const next: FilterProjectionNode[] = [];
      for (let c = 0; c < cursors.length; c++) {
        step.keys.forEach((k) => {
          next.push(getOrCreateChildProj(cursors[c], k));
        });
      }
      cursors = next;
    } else {
      // wildcard, index, slice, script, or nested filter at current cursors
      for (let c = 0; c < cursors.length; c++) {
        if (cursors[c] === root) {
          return null;
        }
        cursors[c].captureFull = true;
      }
      return root;
    }
  }

  for (let c = 0; c < cursors.length; c++) {
    if (cursors[c] === root) {
      return null;
    }
    cursors[c].captureFull = true;
  }
  return root;
}

function unquoteJsonString(raw: string): string {
  if (raw.indexOf("\\") === -1) {
    return raw.slice(1, -1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(1, -1);
  }
}

function parseJsonScalar(valNode: string): any {
  if (valNode === "true") return true;
  if (valNode === "false") return false;
  if (valNode === "null") return null;
  if (valNode.length > 0 && valNode.charCodeAt(0) === 0x22) {
    return unquoteJsonString(valNode);
  }
  return Number(valNode);
}

interface PrunedStackEntry {
  type: "object" | "array";
  container: any;
  projNode: FilterProjectionNode | null;
  pendingKey: string | null;
  pendingProj: FilterProjectionNode | null;
  skippingCurrentValue: boolean;
}

class PrunedJsBuilder {
  private stack: PrunedStackEntry[] = [];
  private skipDepth = 0;
  done = false;
  result: any = undefined;

  constructor(private rootProj: FilterProjectionNode) {}

  isSkipping(): boolean {
    if (this.skipDepth > 0) return true;
    const len = this.stack.length;
    return len > 0 && this.stack[len - 1].skippingCurrentValue;
  }

  openObject(keyNode?: string) {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return;
    }
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent.skippingCurrentValue) {
      parent.skippingCurrentValue = false;
      this.skipDepth = 1;
      return;
    }
    const projNode = !parent
      ? this.rootProj
      : parent.type === "object"
      ? parent.pendingProj
      : null;

    const obj: any = {};
    if (!parent) {
      this.result = obj;
    } else if (parent.type === "object") {
      parent.container[parent.pendingKey as string] = obj;
      parent.pendingKey = null;
      parent.pendingProj = null;
    } else {
      parent.container.push(obj);
    }

    this.stack.push({
      type: "object",
      container: obj,
      projNode: projNode && !projNode.captureFull ? projNode : null,
      pendingKey: null,
      pendingProj: null,
      skippingCurrentValue: false,
    });

    if (keyNode !== undefined) {
      this.key(keyNode);
    }
  }

  closeObject() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDepth === 0 && this.stack.length === 0) {
        this.done = true;
      }
      return;
    }
    this.stack.pop();
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  openArray() {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return;
    }
    const parent = this.stack[this.stack.length - 1];
    if (parent && parent.skippingCurrentValue) {
      parent.skippingCurrentValue = false;
      this.skipDepth = 1;
      return;
    }
    const projNode = !parent
      ? this.rootProj
      : parent.type === "object"
      ? parent.pendingProj
      : null;

    const arr: any[] = [];
    if (!parent) {
      this.result = arr;
    } else if (parent.type === "object") {
      parent.container[parent.pendingKey as string] = arr;
      parent.pendingKey = null;
      parent.pendingProj = null;
    } else {
      parent.container.push(arr);
    }

    if (projNode && !projNode.captureFull) {
      this.skipDepth = 1;
      return;
    }

    this.stack.push({
      type: "array",
      container: arr,
      projNode: null,
      pendingKey: null,
      pendingProj: null,
      skippingCurrentValue: false,
    });
  }

  closeArray() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDepth === 0 && this.stack.length === 0) {
        this.done = true;
      }
      return;
    }
    this.stack.pop();
    if (this.stack.length === 0) {
      this.done = true;
    }
  }

  key(keyNode: string) {
    if (this.skipDepth > 0) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    const k = unquoteJsonString(keyNode);
    if (top.projNode === null) {
      top.pendingKey = k;
    } else {
      const childProj = top.projNode.children.get(k);
      if (childProj === undefined) {
        top.skippingCurrentValue = true;
      } else {
        top.pendingKey = k;
        top.pendingProj = childProj;
        top.skippingCurrentValue = false;
      }
    }
  }

  value(valNode: string) {
    if (this.skipDepth > 0) {
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.result = parseJsonScalar(valNode);
      this.done = true;
      return;
    }
    if (top.skippingCurrentValue) {
      top.skippingCurrentValue = false;
      return;
    }
    const val = parseJsonScalar(valNode);
    if (top.type === "object") {
      top.container[top.pendingKey as string] = val;
      top.pendingKey = null;
      top.pendingProj = null;
    } else {
      top.container.push(val);
    }
  }
}

interface PendingSlot {
  done: boolean;
  streaming: boolean;
  results: Array<string | PendingSlot>;
}

interface ActiveCapture {
  slot: PendingSlot;
  collector: JsonValueCollector;
  pathSegments?: Array<string | number>;
}

interface ActiveFilter {
  slot: PendingSlot;
  collector: JsonValueCollector | null;
  builder: PrunedJsBuilder | null;
  step: Extract<JsonPathStep, { kind: "filter" }>;
  nextStepIndex: number;
  basePath?: Array<string | number>;
}

interface ActiveArrayCollector {
  slot: PendingSlot;
  stepIndex: number;
  step: JsonPathStep;
  nextStepIndex: number;
  depth: number;
  tailKeep: number | null;
  maxCollectIndex: number | null;
  totalCount: number;
  elements: string[];
  currentElementCollector: JsonValueCollector | null;
  basePath?: Array<string | number>;
}

interface ActiveBranch {
  stepIdx: number;
  targetSlot?: PendingSlot;
}

interface ActiveUnionGroup {
  stepIdx: number;
  step: Extract<JsonPathStep, { kind: "union" | "unionKeys" }>;
  slots: PendingSlot[];
  keyToSlot?: Map<string, PendingSlot>;
}

interface Frame {
  type: "object" | "array";
  depth: number;
  activeBranches: ActiveBranch[];
  elementIndex: number;
  currentKey?: string;
  pendingChildBranches: ActiveBranch[];
  arrayCollectors: ActiveArrayCollector[];
  unionGroups: ActiveUnionGroup[];
}

function pushUniqueBranch(
  arr: ActiveBranch[],
  stepIdx: number,
  targetSlot?: PendingSlot
) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].stepIdx === stepIdx && arr[i].targetSlot === targetSlot) {
      return;
    }
  }
  arr.push(targetSlot ? { stepIdx, targetSlot } : { stepIdx });
}

function getSelectorMaxPositiveIndex(step: JsonPathStep): number | null {
  if (step.kind === "index" && !step.rawIndexes.some((n) => n < 0)) {
    return Math.max(...step.rawIndexes);
  }
  if (step.kind === "slice" && step.step === 0) {
    return -1;
  }
  if (
    step.kind === "slice" &&
    step.step > 0 &&
    (step.start === undefined || step.start >= 0) &&
    step.end !== undefined &&
    step.end >= 0
  ) {
    return step.end - 1;
  }
  if (
    step.kind === "script" &&
    step.staticIndex !== undefined &&
    step.staticIndex >= 0
  ) {
    return step.staticIndex;
  }
  return null;
}

type DeferredRootItem =
  | {
      kind: "filter";
      flt: ActiveFilter;
      parsed: any;
      raw?: string;
    }
  | {
      kind: "scalarFilter";
      slot: PendingSlot;
      step: Extract<JsonPathStep, { kind: "filter" }>;
      nextStepIndex: number;
      parsed: any;
      raw: string;
      basePath?: Array<string | number>;
    }
  | {
      kind: "arrayCollector";
      ac: ActiveArrayCollector;
    };

export class StreamingPathEngine implements SaxHandler {
  private frameStack: Frame[] = [];
  private pendingSlots: PendingSlot[] = [];
  private activeCaptures: ActiveCapture[] = [];
  private activeFilters: ActiveFilter[] = [];
  private activeElCollectors: ActiveArrayCollector[] = [];
  private hasEmitted = false;
  private rootPendingBranches: ActiveBranch[] = [];
  private skipDepth = 0;
  private filterProjectionMap = new Map<
    Extract<JsonPathStep, { kind: "filter" }>,
    FilterProjectionNode | null
  >();
  private rootMaxIndex: number | null = null;
  private earlyExited = false;
  private needsRootValue = false;
  private rootReady = false;
  private rootValue: any = undefined;
  private rootBuilder: PrunedJsBuilder | null = null;
  private rootCollector: JsonValueCollector | null = null;
  private deferredRootFilters: DeferredRootItem[] = [];
  private trackPaths: boolean;
  private rootQueryHandled = false;

  skipDecode = false;
  onend: () => void = () => {};
  onclose: () => void = () => {};
  onerror: (er: any) => void = () => {};

  constructor(
    private steps: JsonPathStep[],
    private emitOutput: (chunk: string) => void,
    private onEarlyExit?: () => void,
    private resultType: ResultType = "value"
  ) {
    this.trackPaths = resultType !== "value";
    if (steps.length > 0) {
      this.rootPendingBranches = [{ stepIdx: 0 }];
      this.needsRootValue = this.collectStepsRootUsage(steps);
      if (this.needsRootValue) {
        const rootProj = buildRootProjection(steps);
        if (rootProj) {
          this.rootBuilder = new PrunedJsBuilder(rootProj);
        } else {
          this.rootCollector = new JsonValueCollector();
        }
      }
      const s0 = steps[0];
      if (!s0.recursive) {
        if (s0.kind === "union") {
          let unionMax = -1;
          let allBounded = true;
          for (let i = 0; i < s0.selectors.length; i++) {
            const selMax = getSelectorMaxPositiveIndex(s0.selectors[i]);
            if (selMax === null) {
              allBounded = false;
              break;
            }
            if (selMax > unionMax) {
              unionMax = selMax;
            }
          }
          if (allBounded) {
            this.rootMaxIndex = unionMax;
          }
        } else {
          this.rootMaxIndex = getSelectorMaxPositiveIndex(s0);
        }
      }
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        const remaining = steps.slice(i + 1);
        if (st.kind === "filter") {
          this.filterProjectionMap.set(
            st,
            buildFilterProjection(st.ast, remaining)
          );
        } else if (st.kind === "union") {
          for (let s = 0; s < st.selectors.length; s++) {
            const sel = st.selectors[s];
            if (sel.kind === "filter") {
              this.filterProjectionMap.set(
                sel,
                buildFilterProjection(sel.ast, remaining)
              );
            }
          }
        }
      }
    }
  }

  private collectStepsRootUsage(steps: JsonPathStep[]): boolean {
    const asts: ExprNode[] = [];
    collectNestedFilterAsts(steps, asts);
    for (let i = 0; i < asts.length; i++) {
      if (ConditionEval.usesRoot(asts[i])) {
        return true;
      }
    }
    return false;
  }

  private completeRootCapture() {
    if (this.rootBuilder) {
      this.rootValue = this.rootBuilder.result;
      this.rootBuilder = null;
    } else if (this.rootCollector) {
      const raw = this.rootCollector.chunks.join("");
      try {
        this.rootValue = JSON.parse(raw);
      } catch {
        this.rootValue = undefined;
      }
      this.rootCollector = null;
    }
    this.rootReady = true;
    this.flushDeferredRootFilters();
  }

  private feedRootOpenObject(keyNode?: string) {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.openObject(keyNode);
    } else if (this.rootCollector) {
      this.rootCollector.openObject(keyNode);
    }
  }

  private feedRootCloseObject() {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.closeObject();
      if (this.rootBuilder.done) {
        this.completeRootCapture();
      }
    } else if (this.rootCollector) {
      this.rootCollector.closeObject();
      if (this.rootCollector.done) {
        this.completeRootCapture();
      }
    }
  }

  private feedRootOpenArray() {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.openArray();
    } else if (this.rootCollector) {
      this.rootCollector.openArray();
    }
  }

  private feedRootCloseArray() {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.closeArray();
      if (this.rootBuilder.done) {
        this.completeRootCapture();
      }
    } else if (this.rootCollector) {
      this.rootCollector.closeArray();
      if (this.rootCollector.done) {
        this.completeRootCapture();
      }
    }
  }

  private feedRootKey(keyNode: string) {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.key(keyNode);
    } else if (this.rootCollector) {
      this.rootCollector.key(keyNode);
    }
  }

  private feedRootValue(valNode: string) {
    if (!this.needsRootValue || this.rootReady) {
      return;
    }
    if (this.rootBuilder) {
      this.rootBuilder.value(valNode);
      if (this.rootBuilder.done) {
        this.completeRootCapture();
      }
    } else if (this.rootCollector) {
      this.rootCollector.value(valNode);
      if (this.rootCollector.done) {
        this.completeRootCapture();
      }
    }
  }

  private flushDeferredRootFilters() {
    if (this.deferredRootFilters.length === 0) {
      return;
    }
    const items = this.deferredRootFilters;
    this.deferredRootFilters = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "filter") {
        this.applyFilterEvaluation(item.flt, item.parsed, item.raw);
      } else if (item.kind === "scalarFilter") {
        if (ConditionEval.evalFilterAst(item.step.ast, item.parsed, this.rootValue)) {
          if (item.nextStepIndex >= this.steps.length) {
            if (this.trackPaths) {
              item.slot.results.push(
                formatResultPayload(this.resultType, item.basePath!, item.raw)
              );
            } else {
              item.slot.results.push(item.raw);
            }
          } else if (this.trackPaths) {
            const matched = evaluateStepsWithPaths(
              item.parsed,
              this.steps,
              item.nextStepIndex,
              this.rootValue,
              item.basePath!
            );
            for (let k = 0; k < matched.length; k++) {
              item.slot.results.push(
                formatResultPayload(
                  this.resultType,
                  matched[k].path,
                  JSON.stringify(matched[k].value)
                )
              );
            }
          } else {
            const matched = evaluateStepsOnValue(
              item.parsed,
              this.steps,
              item.nextStepIndex,
              this.rootValue
            );
            for (let k = 0; k < matched.length; k++) {
              item.slot.results.push(JSON.stringify(matched[k]));
            }
          }
        }
        item.slot.done = true;
      } else {
        this.applyArrayCollectorEvaluation(item.ac);
      }
    }
  }

  private updateSkipDecode() {
    if (this.needsRootValue && !this.rootReady) {
      if (this.rootCollector) {
        this.skipDecode = false;
        return;
      }
      if (
        this.rootBuilder &&
        this.activeCaptures.length === 0 &&
        this.activeElCollectors.length === 0 &&
        this.skipDepth > 0 &&
        this.rootBuilder.isSkipping()
      ) {
        let allSkipping = true;
        for (let i = 0; i < this.activeFilters.length; i++) {
          const b = this.activeFilters[i].builder;
          if (!b || !b.isSkipping()) {
            allSkipping = false;
            break;
          }
        }
        this.skipDecode = allSkipping;
        return;
      }
      this.skipDecode = false;
      return;
    }

    if (
      this.activeCaptures.length === 0 &&
      this.activeElCollectors.length === 0
    ) {
      if (this.skipDepth > 0 && this.activeFilters.length === 0) {
        this.skipDecode = true;
        return;
      }
      if (this.activeFilters.length > 0 && this.skipDepth > 0) {
        let allSkipping = true;
        for (let i = 0; i < this.activeFilters.length; i++) {
          const b = this.activeFilters[i].builder;
          if (!b || !b.isSkipping()) {
            allSkipping = false;
            break;
          }
        }
        this.skipDecode = allSkipping;
        return;
      }
    }
    this.skipDecode = false;
  }

  private finalizeUnionGroups(frame: Frame) {
    for (let i = 0; i < frame.unionGroups.length; i++) {
      const slots = frame.unionGroups[i].slots;
      for (let j = 0; j < slots.length; j++) {
        slots[j].done = true;
      }
    }
  }

  private checkEarlyExit() {
    if (this.needsRootValue && !this.rootReady) {
      return;
    }
    if (
      !this.earlyExited &&
      this.rootMaxIndex !== null &&
      this.skipDepth === 0 &&
      this.frameStack.length === 1 &&
      this.frameStack[0].type === "array" &&
      this.frameStack[0].elementIndex >= this.rootMaxIndex &&
      this.activeCaptures.length === 0 &&
      this.activeFilters.length === 0 &&
      this.activeElCollectors.length === 0
    ) {
      if (this.frameStack[0].unionGroups.length > 0) {
        this.finalizeUnionGroups(this.frameStack[0]);
        this.flushPendingSlots();
      }
      if (this.pendingSlots.length === 0) {
        this.earlyExited = true;
        if (this.onEarlyExit) {
          this.onEarlyExit();
        }
      }
    }
  }

  private emitResultString(rawJson: string) {
    if (this.hasEmitted) {
      this.emitOutput(`,${rawJson}`);
    } else {
      this.emitOutput(rawJson);
      this.hasEmitted = true;
    }
  }

  private createSlot(
    streamingCandidate: boolean,
    targetSlot?: PendingSlot
  ): PendingSlot {
    const canStream =
      !targetSlot && streamingCandidate && this.pendingSlots.length === 0;
    const slot: PendingSlot = {
      done: false,
      streaming: canStream,
      results: [],
    };
    if (targetSlot) {
      targetSlot.results.push(slot);
    } else {
      this.pendingSlots.push(slot);
    }
    return slot;
  }

  private flushNestedItems(slot: PendingSlot) {
    if (slot.streaming) {
      return;
    }
    while (slot.results.length > 0) {
      const item = slot.results[0];
      if (typeof item === "string") {
        slot.results.shift();
        this.emitResultString(item);
      } else {
        this.flushNestedItems(item);
        if (!item.done || item.results.length > 0) {
          break;
        }
        slot.results.shift();
      }
    }
  }

  private flushPendingSlots() {
    while (this.pendingSlots.length > 0) {
      const head = this.pendingSlots[0];
      this.flushNestedItems(head);
      if (!head.done || head.results.length > 0) {
        break;
      }
      this.pendingSlots.shift();
    }
  }

  private getCurrentPathSnapshot(): Array<string | number> {
    const path: Array<string | number> = [];
    for (let i = 0; i < this.frameStack.length; i++) {
      const f = this.frameStack[i];
      if (f.type === "object") {
        if (f.currentKey !== undefined) {
          path.push(f.currentKey);
        }
      } else if (f.elementIndex >= 0) {
        path.push(f.elementIndex);
      }
    }
    return path;
  }

  private startDirectCapture(
    targetSlot?: PendingSlot,
    pathOverride?: Array<string | number>
  ): ActiveCapture | null {
    if (this.trackPaths) {
      const pathSegments = pathOverride || this.getCurrentPathSnapshot();
      if (this.resultType === "path" || this.resultType === "pointer") {
        const formatted = formatResultPayload(this.resultType, pathSegments);
        const slot = this.createSlot(true, targetSlot);
        if (slot.streaming) {
          this.emitResultString(formatted);
        } else {
          slot.results.push(formatted);
        }
        slot.done = true;
        return null;
      }
      // resultType === "all": buffer raw value JSON, then wrap {path, pointer, value}
      const slot = this.createSlot(false, targetSlot);
      const collector = new JsonValueCollector();
      const cap: ActiveCapture = { slot, collector, pathSegments };
      this.activeCaptures.push(cap);
      return cap;
    }

    const slot = this.createSlot(true, targetSlot);
    let startedComma = false;
    const collector = new JsonValueCollector(
      slot.streaming
        ? (token: string) => {
            if (!startedComma) {
              startedComma = true;
              if (this.hasEmitted) {
                this.emitOutput(",");
              }
              this.hasEmitted = true;
            }
            this.emitOutput(token);
          }
        : undefined
    );
    const cap: ActiveCapture = { slot, collector };
    this.activeCaptures.push(cap);
    return cap;
  }

  private startFilterCandidate(
    step: Extract<JsonPathStep, { kind: "filter" }>,
    nextStepIndex: number,
    targetSlot?: PendingSlot
  ): ActiveFilter {
    const slot = this.createSlot(false, targetSlot);
    const proj = this.filterProjectionMap.get(step) || null;
    const filter: ActiveFilter = {
      slot,
      collector: proj ? null : new JsonValueCollector(),
      builder: proj ? new PrunedJsBuilder(proj) : null,
      step,
      nextStepIndex,
      basePath: this.trackPaths ? this.getCurrentPathSnapshot() : undefined,
    };
    this.activeFilters.push(filter);
    return filter;
  }

  private finalizeCapture(cap: ActiveCapture) {
    cap.slot.done = true;
    if (!cap.slot.streaming) {
      const raw = cap.collector.chunks.join("");
      if (this.trackPaths) {
        cap.slot.results.push(
          formatResultPayload(this.resultType, cap.pathSegments!, raw)
        );
      } else {
        cap.slot.results.push(raw);
      }
    }
  }

  private applyFilterEvaluation(flt: ActiveFilter, parsed: any, raw?: string) {
    if (ConditionEval.evalFilterAst(flt.step.ast, parsed, this.rootValue)) {
      if (flt.nextStepIndex >= this.steps.length && raw !== undefined) {
        if (this.trackPaths) {
          flt.slot.results.push(
            formatResultPayload(this.resultType, flt.basePath!, raw)
          );
        } else {
          flt.slot.results.push(raw);
        }
      } else if (this.trackPaths) {
        const matched = evaluateStepsWithPaths(
          parsed,
          this.steps,
          flt.nextStepIndex,
          this.rootValue,
          flt.basePath!
        );
        for (let i = 0; i < matched.length; i++) {
          flt.slot.results.push(
            formatResultPayload(
              this.resultType,
              matched[i].path,
              JSON.stringify(matched[i].value)
            )
          );
        }
      } else {
        const matched = evaluateStepsOnValue(
          parsed,
          this.steps,
          flt.nextStepIndex,
          this.rootValue
        );
        for (let i = 0; i < matched.length; i++) {
          flt.slot.results.push(JSON.stringify(matched[i]));
        }
      }
    }
    flt.slot.done = true;
  }

  private finalizeFilter(flt: ActiveFilter) {
    if (flt.builder) {
      const parsed = flt.builder.result;
      if (this.needsRootValue && !this.rootReady) {
        this.deferredRootFilters.push({ kind: "filter", flt, parsed });
        return;
      }
      this.applyFilterEvaluation(flt, parsed);
      return;
    }

    const raw = (flt.collector as JsonValueCollector).chunks.join("");
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (this.needsRootValue && !this.rootReady) {
      this.deferredRootFilters.push({ kind: "filter", flt, parsed, raw });
      return;
    }
    this.applyFilterEvaluation(flt, parsed, raw);
  }

  private selectorNeedsArrayCollector(step: JsonPathStep): boolean {
    return (
      (step.kind === "script" && step.staticIndex === undefined) ||
      (step.kind === "index" && step.rawIndexes.some((n) => n < 0)) ||
      (step.kind === "slice" &&
        step.step !== 0 &&
        (step.step < 0 ||
          (step.start !== undefined && step.start < 0) ||
          (step.end !== undefined && step.end < 0)))
    );
  }

  private createArrayCollectorForFrame(
    frame: Frame,
    stepIndex: number,
    step: JsonPathStep,
    slot: PendingSlot
  ) {
    let tailKeep: number | null = null;
    let maxCollectIndex: number | null = null;
    if (step.kind === "script" && step.lengthOffset && step.lengthOffset > 0) {
      tailKeep = step.lengthOffset;
    } else if (step.kind === "slice") {
      if (
        step.step > 0 &&
        step.start !== undefined &&
        step.start < 0 &&
        step.end === undefined
      ) {
        tailKeep = -step.start;
      } else if (step.step < 0 && step.end !== undefined && step.end < 0) {
        tailKeep = Math.max(0, -step.end - 1);
      } else if (
        step.step < 0 &&
        step.start !== undefined &&
        step.start >= 0
      ) {
        maxCollectIndex = step.start;
      }
    }
    frame.arrayCollectors.push({
      slot,
      stepIndex,
      step,
      nextStepIndex: stepIndex + 1,
      depth: frame.depth,
      tailKeep,
      maxCollectIndex,
      totalCount: 0,
      elements: [],
      currentElementCollector: null,
      basePath: this.trackPaths ? this.getCurrentPathSnapshot() : undefined,
    });
  }

  private applyArrayCollectorEvaluation(ac: ActiveArrayCollector) {
    const length = ac.totalCount;
    const matchedIndexes: number[] = [];

    if (ac.step.kind === "script") {
      const idx =
        ac.step.staticIndex !== undefined
          ? ac.step.staticIndex
          : ConditionEval.evalAst(ac.step.ast, { length }, this.rootValue);
      if (
        typeof idx === "number" &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < length
      ) {
        matchedIndexes.push(idx);
      }
    } else if (ac.step.kind === "index") {
      for (let i = 0; i < ac.step.rawIndexes.length; i++) {
        const rawIdx = ac.step.rawIndexes[i];
        const resolved = rawIdx < 0 ? length + rawIdx : rawIdx;
        if (resolved >= 0 && resolved < length) {
          matchedIndexes.push(resolved);
        }
      }
    } else if (ac.step.kind === "slice" && ac.step.step !== 0) {
      const { lower, upper } = resolveSliceBounds(
        length,
        ac.step.start,
        ac.step.end,
        ac.step.step
      );
      if (ac.step.step > 0) {
        for (let i = lower; i < upper; i += ac.step.step) {
          matchedIndexes.push(i);
        }
      } else {
        for (let i = upper; i > lower; i += ac.step.step) {
          matchedIndexes.push(i);
        }
      }
    }

    const baseOffset =
      ac.tailKeep !== null ? Math.max(0, length - ac.tailKeep) : 0;
    for (let i = 0; i < matchedIndexes.length; i++) {
      const resolvedIdx = matchedIndexes[i];
      const arrIdx = resolvedIdx - baseOffset;
      if (arrIdx < 0 || arrIdx >= ac.elements.length) {
        continue;
      }
      const rawEl = ac.elements[arrIdx];
      if (ac.nextStepIndex >= this.steps.length) {
        if (this.trackPaths) {
          ac.slot.results.push(
            formatResultPayload(
              this.resultType,
              [...ac.basePath!, resolvedIdx],
              rawEl
            )
          );
        } else {
          ac.slot.results.push(rawEl);
        }
      } else {
        const parsedEl = JSON.parse(rawEl);
        if (this.trackPaths) {
          const sub = evaluateStepsWithPaths(
            parsedEl,
            this.steps,
            ac.nextStepIndex,
            this.rootValue,
            [...ac.basePath!, resolvedIdx]
          );
          for (let j = 0; j < sub.length; j++) {
            ac.slot.results.push(
              formatResultPayload(
                this.resultType,
                sub[j].path,
                JSON.stringify(sub[j].value)
              )
            );
          }
        } else {
          const sub = evaluateStepsOnValue(
            parsedEl,
            this.steps,
            ac.nextStepIndex,
            this.rootValue
          );
          for (let j = 0; j < sub.length; j++) {
            ac.slot.results.push(JSON.stringify(sub[j]));
          }
        }
      }
    }
    ac.slot.done = true;
  }

  private finalizeArrayCollector(ac: ActiveArrayCollector) {
    if (this.needsRootValue && !this.rootReady) {
      this.deferredRootFilters.push({ kind: "arrayCollector", ac });
      return;
    }
    this.applyArrayCollectorEvaluation(ac);
  }

  private pushCollectedElement(ac: ActiveArrayCollector, rawEl: string) {
    ac.totalCount++;
    if (ac.tailKeep !== null) {
      if (ac.tailKeep === 0) {
        return;
      }
      if (ac.elements.length >= ac.tailKeep) {
        ac.elements.shift();
      }
      ac.elements.push(rawEl);
    } else {
      ac.elements.push(rawEl);
    }
  }

  private initFrame(frame: Frame) {
    const branches = frame.activeBranches;
    for (let i = 0; i < branches.length; i++) {
      const { stepIdx, targetSlot } = branches[i];
      const step = this.steps[stepIdx];
      if (step.kind === "unionKeys") {
        if (frame.type === "object") {
          const slots: PendingSlot[] = [];
          const keyToSlot = new Map<string, PendingSlot>();
          for (let k = 0; k < step.orderedKeys.length; k++) {
            const key = step.orderedKeys[k];
            const slot = this.createSlot(false, targetSlot);
            slots.push(slot);
            keyToSlot.set(key, slot);
          }
          frame.unionGroups.push({ stepIdx, step, slots, keyToSlot });
        }
      } else if (step.kind === "union") {
        const slots: PendingSlot[] = [];
        for (let s = 0; s < step.selectors.length; s++) {
          slots.push(this.createSlot(false, targetSlot));
        }
        frame.unionGroups.push({ stepIdx, step, slots });
        if (frame.type === "array") {
          for (let s = 0; s < step.selectors.length; s++) {
            const sel = step.selectors[s];
            if (this.selectorNeedsArrayCollector(sel)) {
              this.createArrayCollectorForFrame(frame, stepIdx, sel, slots[s]);
            }
          }
        }
      } else if (
        frame.type === "array" &&
        this.selectorNeedsArrayCollector(step)
      ) {
        const slot = this.createSlot(false, targetSlot);
        this.createArrayCollectorForFrame(frame, stepIdx, step, slot);
      }
    }
  }

  private handleObjectKey(frame: Frame, keyNode: string) {
    frame.pendingChildBranches.length = 0;
    const branches = frame.activeBranches;
    if (branches.length === 0) {
      return;
    }

    const keyStr = unquoteJsonString(keyNode);
    if (this.trackPaths) {
      frame.currentKey = keyStr;
    }

    for (let g = 0; g < frame.unionGroups.length; g++) {
      const grp = frame.unionGroups[g];
      if (grp.step.kind === "unionKeys") {
        const slot = grp.keyToSlot!.get(keyStr);
        if (slot) {
          const nextIdx = grp.stepIdx + 1;
          if (nextIdx >= this.steps.length) {
            this.startDirectCapture(slot);
          } else {
            pushUniqueBranch(frame.pendingChildBranches, nextIdx, slot);
          }
        }
      } else {
        const selectors = grp.step.selectors;
        const nextIdx = grp.stepIdx + 1;
        for (let s = 0; s < selectors.length; s++) {
          const sel = selectors[s];
          const slot = grp.slots[s];
          let matched = false;
          if (sel.kind === "child" && sel.key === keyStr) {
            matched = true;
          } else if (sel.kind === "wildcard") {
            matched = true;
          } else if (sel.kind === "filter") {
            this.startFilterCandidate(sel, nextIdx, slot);
          }
          if (matched) {
            if (nextIdx >= this.steps.length) {
              this.startDirectCapture(slot);
            } else {
              pushUniqueBranch(frame.pendingChildBranches, nextIdx, slot);
            }
          }
        }
      }
    }

    for (let i = 0; i < branches.length; i++) {
      const { stepIdx, targetSlot } = branches[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "child" && step.key === keyStr) {
        matched = true;
      } else if (step.kind === "wildcard") {
        matched = true;
      } else if (step.kind === "filter") {
        this.startFilterCandidate(step, stepIdx + 1, targetSlot);
      }

      if (matched) {
        const nextIdx = stepIdx + 1;
        if (nextIdx >= this.steps.length) {
          this.startDirectCapture(targetSlot);
        } else {
          pushUniqueBranch(frame.pendingChildBranches, nextIdx, targetSlot);
        }
      }

      if (step.recursive) {
        pushUniqueBranch(frame.pendingChildBranches, stepIdx, targetSlot);
      }
    }
  }

  private evaluateArrayElementSteps(
    frame: Frame,
    isScalar: boolean,
    scalarNode?: string
  ): ActiveBranch[] {
    frame.elementIndex++;
    const idx = frame.elementIndex;
    const elementBranches: ActiveBranch[] = [];

    const frameCols = frame.arrayCollectors;
    for (let i = 0; i < frameCols.length; i++) {
      const ac = frameCols[i];
      if (
        ac.tailKeep === 0 ||
        (ac.maxCollectIndex !== null && idx > ac.maxCollectIndex)
      ) {
        ac.totalCount++;
      } else if (isScalar && scalarNode !== undefined) {
        this.pushCollectedElement(ac, scalarNode);
      } else {
        ac.currentElementCollector = new JsonValueCollector();
        this.activeElCollectors.push(ac);
      }
    }

    for (let g = 0; g < frame.unionGroups.length; g++) {
      const grp = frame.unionGroups[g];
      if (grp.step.kind !== "union") {
        continue;
      }
      const selectors = grp.step.selectors;
      const nextIdx = grp.stepIdx + 1;
      for (let s = 0; s < selectors.length; s++) {
        const sel = selectors[s];
        const slot = grp.slots[s];
        let matched = false;

        if (sel.kind === "index") {
          if (!sel.rawIndexes.some((n) => n < 0) && sel.indexes.has(idx)) {
            matched = true;
          }
        } else if (sel.kind === "slice") {
          const hasNeg =
            sel.step <= 0 ||
            (sel.start !== undefined && sel.start < 0) ||
            (sel.end !== undefined && sel.end < 0);
          if (!hasNeg) {
            const start = sel.start !== undefined ? sel.start : 0;
            if (
              idx >= start &&
              (sel.end === undefined || idx < sel.end) &&
              (idx - start) % sel.step === 0
            ) {
              matched = true;
            }
          }
        } else if (sel.kind === "script" && sel.staticIndex !== undefined) {
          if (idx === sel.staticIndex) {
            matched = true;
          }
        } else if (sel.kind === "wildcard") {
          matched = true;
        } else if (sel.kind === "filter") {
          if (isScalar && scalarNode !== undefined) {
            let parsed: any;
            try {
              parsed = JSON.parse(scalarNode);
            } catch {
              parsed = undefined;
            }
            if (this.needsRootValue && !this.rootReady) {
              const subSlot = this.createSlot(false, slot);
              this.deferredRootFilters.push({
                kind: "scalarFilter",
                slot: subSlot,
                step: sel,
                nextStepIndex: nextIdx,
                parsed,
                raw: scalarNode,
                basePath: this.trackPaths
                  ? this.getCurrentPathSnapshot()
                  : undefined,
              });
            } else if (ConditionEval.evalFilterAst(sel.ast, parsed, this.rootValue)) {
              if (nextIdx >= this.steps.length) {
                if (this.trackPaths) {
                  slot.results.push(
                    formatResultPayload(
                      this.resultType,
                      this.getCurrentPathSnapshot(),
                      scalarNode
                    )
                  );
                } else {
                  slot.results.push(scalarNode);
                }
              } else if (this.trackPaths) {
                const sub = evaluateStepsWithPaths(
                  parsed,
                  this.steps,
                  nextIdx,
                  this.rootValue,
                  this.getCurrentPathSnapshot()
                );
                for (let k = 0; k < sub.length; k++) {
                  slot.results.push(
                    formatResultPayload(
                      this.resultType,
                      sub[k].path,
                      JSON.stringify(sub[k].value)
                    )
                  );
                }
              } else {
                const sub = evaluateStepsOnValue(
                  parsed,
                  this.steps,
                  nextIdx,
                  this.rootValue
                );
                for (let k = 0; k < sub.length; k++) {
                  slot.results.push(JSON.stringify(sub[k]));
                }
              }
            }
          } else {
            this.startFilterCandidate(sel, nextIdx, slot);
          }
        }

        if (matched) {
          if (nextIdx >= this.steps.length) {
            if (isScalar && scalarNode !== undefined) {
              if (this.trackPaths) {
                slot.results.push(
                  formatResultPayload(
                    this.resultType,
                    this.getCurrentPathSnapshot(),
                    scalarNode
                  )
                );
              } else {
                slot.results.push(scalarNode);
              }
            } else {
              this.startDirectCapture(slot);
            }
          } else {
            pushUniqueBranch(elementBranches, nextIdx, slot);
          }
        }
      }
    }

    const branches = frame.activeBranches;
    for (let i = 0; i < branches.length; i++) {
      const { stepIdx, targetSlot } = branches[i];
      const step = this.steps[stepIdx];
      let matched = false;

      if (step.kind === "index") {
        if (!step.rawIndexes.some((n) => n < 0) && step.indexes.has(idx)) {
          matched = true;
        }
      } else if (step.kind === "slice") {
        const hasNeg =
          step.step <= 0 ||
          (step.start !== undefined && step.start < 0) ||
          (step.end !== undefined && step.end < 0);
        if (!hasNeg) {
          const start = step.start !== undefined ? step.start : 0;
          if (
            idx >= start &&
            (step.end === undefined || idx < step.end) &&
            (idx - start) % step.step === 0
          ) {
            matched = true;
          }
        }
      } else if (step.kind === "script" && step.staticIndex !== undefined) {
        if (idx === step.staticIndex) {
          matched = true;
        }
      } else if (step.kind === "wildcard") {
        matched = true;
      } else if (step.kind === "filter") {
        if (isScalar && scalarNode !== undefined) {
          let parsed: any;
          try {
            parsed = JSON.parse(scalarNode);
          } catch {
            parsed = undefined;
          }
          if (this.needsRootValue && !this.rootReady) {
            const slot = this.createSlot(false, targetSlot);
            this.deferredRootFilters.push({
              kind: "scalarFilter",
              slot,
              step,
              nextStepIndex: stepIdx + 1,
              parsed,
              raw: scalarNode,
              basePath: this.trackPaths
                ? this.getCurrentPathSnapshot()
                : undefined,
            });
          } else if (ConditionEval.evalFilterAst(step.ast, parsed, this.rootValue)) {
            const nextIdx = stepIdx + 1;
            if (nextIdx >= this.steps.length) {
              const slot = this.createSlot(false, targetSlot);
              if (this.trackPaths) {
                slot.results.push(
                  formatResultPayload(
                    this.resultType,
                    this.getCurrentPathSnapshot(),
                    scalarNode
                  )
                );
              } else {
                slot.results.push(scalarNode);
              }
              slot.done = true;
            } else if (this.trackPaths) {
              const sub = evaluateStepsWithPaths(
                parsed,
                this.steps,
                nextIdx,
                this.rootValue,
                this.getCurrentPathSnapshot()
              );
              if (sub.length > 0) {
                const slot = this.createSlot(false, targetSlot);
                for (let k = 0; k < sub.length; k++) {
                  slot.results.push(
                    formatResultPayload(
                      this.resultType,
                      sub[k].path,
                      JSON.stringify(sub[k].value)
                    )
                  );
                }
                slot.done = true;
              }
            } else {
              const sub = evaluateStepsOnValue(
                parsed,
                this.steps,
                nextIdx,
                this.rootValue
              );
              if (sub.length > 0) {
                const slot = this.createSlot(false, targetSlot);
                for (let k = 0; k < sub.length; k++) {
                  slot.results.push(JSON.stringify(sub[k]));
                }
                slot.done = true;
              }
            }
          }
        } else {
          this.startFilterCandidate(step, stepIdx + 1, targetSlot);
        }
      }

      if (matched) {
        const nextIdx = stepIdx + 1;
        if (nextIdx >= this.steps.length) {
          if (isScalar && scalarNode !== undefined) {
            const slot = this.createSlot(true, targetSlot);
            const payload = this.trackPaths
              ? formatResultPayload(
                  this.resultType,
                  this.getCurrentPathSnapshot(),
                  scalarNode
                )
              : scalarNode;
            if (slot.streaming) {
              this.emitResultString(payload);
            } else {
              slot.results.push(payload);
            }
            slot.done = true;
          } else {
            this.startDirectCapture(targetSlot);
          }
        } else {
          pushUniqueBranch(elementBranches, nextIdx, targetSlot);
        }
      }

      if (step.recursive) {
        pushUniqueBranch(elementBranches, stepIdx, targetSlot);
      }
    }

    return elementBranches;
  }

  onopenobject(keyNode?: string) {
    if (this.steps.length === 0 && !this.rootQueryHandled && this.trackPaths) {
      this.rootQueryHandled = true;
      const cap = this.startDirectCapture(undefined, []);
      if (cap) {
        cap.collector.openObject(keyNode);
      }
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }
    this.feedRootOpenObject(keyNode);
    if (this.skipDepth > 0) {
      if (!this.skipDecode) {
        for (let i = 0; i < this.activeCaptures.length; i++) {
          this.activeCaptures[i].collector.openObject(keyNode);
        }
        for (let i = 0; i < this.activeFilters.length; i++) {
          const flt = this.activeFilters[i];
          if (flt.builder) flt.builder.openObject(keyNode);
          else (flt.collector as JsonValueCollector).openObject(keyNode);
        }
        for (let i = 0; i < this.activeElCollectors.length; i++) {
          this.activeElCollectors[i].currentElementCollector?.openObject(
            keyNode
          );
        }
        if (this.activeFilters.length > 0 || (this.needsRootValue && !this.rootReady)) {
          this.updateSkipDecode();
        }
      } else {
        for (let i = 0; i < this.activeFilters.length; i++) {
          this.activeFilters[i].builder?.openObject(keyNode);
        }
        if (this.activeFilters.length > 0 || (this.needsRootValue && !this.rootReady)) {
          this.updateSkipDecode();
        }
      }
      this.skipDepth++;
      return;
    }

    // 1. Forward to already-active captures, filters, and array element collectors
    const prevCaptureCount = this.activeCaptures.length;
    const prevFilterCount = this.activeFilters.length;
    const prevElColCount = this.activeElCollectors.length;

    for (let i = 0; i < prevCaptureCount; i++) {
      this.activeCaptures[i].collector.openObject(keyNode);
    }
    for (let i = 0; i < prevFilterCount; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.openObject(keyNode);
      else (flt.collector as JsonValueCollector).openObject(keyNode);
    }
    for (let i = 0; i < prevElColCount; i++) {
      this.activeElCollectors[i].currentElementCollector?.openObject(keyNode);
    }

    // 2. Determine incoming branches for this new object
    let incomingBranches: ActiveBranch[];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingBranches = this.rootPendingBranches;
      this.rootPendingBranches = [];
    } else if (parent.type === "object") {
      incomingBranches = parent.pendingChildBranches;
      parent.pendingChildBranches = [];
    } else {
      incomingBranches = this.evaluateArrayElementSteps(parent, false);
      for (let i = prevCaptureCount; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.openObject(keyNode);
      }
      for (let i = prevFilterCount; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.openObject(keyNode);
        else (flt.collector as JsonValueCollector).openObject(keyNode);
      }
      for (let i = prevElColCount; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.openObject(keyNode);
      }
    }

    if (incomingBranches.length === 0) {
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }

    // 3. Push object frame & initialize any union/unionKeys groups
    const frame: Frame = {
      type: "object",
      depth: this.frameStack.length + 1,
      activeBranches: incomingBranches,
      elementIndex: -1,
      pendingChildBranches: [],
      arrayCollectors: [],
      unionGroups: [],
    };
    this.frameStack.push(frame);
    this.initFrame(frame);

    // 4. Process first key if object is non-empty
    if (keyNode !== undefined) {
      this.handleObjectKey(frame, keyNode);
    }
  }

  oncloseobject() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDecode && this.activeFilters.length === 0) {
        this.feedRootCloseObject();
        if (!this.needsRootValue || this.rootReady) {
          this.flushPendingSlots();
        }
        if (this.skipDepth === 0) {
          this.updateSkipDecode();
          this.checkEarlyExit();
        }
        return;
      }
      this.advanceCloseObjectOnActive();
      this.feedRootCloseObject();
      this.updateSkipDecode();
      this.flushPendingSlots();
      this.checkEarlyExit();
      return;
    }

    const closedFrame = this.frameStack.pop();
    this.advanceCloseObjectOnActive();
    if (closedFrame && closedFrame.unionGroups.length > 0) {
      this.finalizeUnionGroups(closedFrame);
    }
    this.feedRootCloseObject();
    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceCloseObjectOnActive() {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.closeObject();
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.closeObject();
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.closeObject();
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.closeObject();
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }

  onopenarray() {
    if (this.steps.length === 0 && !this.rootQueryHandled && this.trackPaths) {
      this.rootQueryHandled = true;
      const cap = this.startDirectCapture(undefined, []);
      if (cap) {
        cap.collector.openArray();
      }
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }
    this.feedRootOpenArray();
    if (this.skipDepth > 0) {
      if (!this.skipDecode) {
        for (let i = 0; i < this.activeCaptures.length; i++) {
          this.activeCaptures[i].collector.openArray();
        }
        for (let i = 0; i < this.activeFilters.length; i++) {
          const flt = this.activeFilters[i];
          if (flt.builder) flt.builder.openArray();
          else (flt.collector as JsonValueCollector).openArray();
        }
        for (let i = 0; i < this.activeElCollectors.length; i++) {
          this.activeElCollectors[i].currentElementCollector?.openArray();
        }
        if (this.activeFilters.length > 0 || (this.needsRootValue && !this.rootReady)) {
          this.updateSkipDecode();
        }
      } else {
        for (let i = 0; i < this.activeFilters.length; i++) {
          this.activeFilters[i].builder?.openArray();
        }
        if (this.activeFilters.length > 0 || (this.needsRootValue && !this.rootReady)) {
          this.updateSkipDecode();
        }
      }
      this.skipDepth++;
      return;
    }

    // 1. Forward to already-active captures, filters, and array element collectors
    const prevCaptureCount = this.activeCaptures.length;
    const prevFilterCount = this.activeFilters.length;
    const prevElColCount = this.activeElCollectors.length;

    for (let i = 0; i < prevCaptureCount; i++) {
      this.activeCaptures[i].collector.openArray();
    }
    for (let i = 0; i < prevFilterCount; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.openArray();
      else (flt.collector as JsonValueCollector).openArray();
    }
    for (let i = 0; i < prevElColCount; i++) {
      this.activeElCollectors[i].currentElementCollector?.openArray();
    }

    // 2. Determine incoming branches for this new array
    let incomingBranches: ActiveBranch[];
    const parent = this.frameStack[this.frameStack.length - 1];
    if (!parent) {
      incomingBranches = this.rootPendingBranches;
      this.rootPendingBranches = [];
    } else if (parent.type === "object") {
      incomingBranches = parent.pendingChildBranches;
      parent.pendingChildBranches = [];
    } else {
      incomingBranches = this.evaluateArrayElementSteps(parent, false);
      for (let i = prevCaptureCount; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.openArray();
      }
      for (let i = prevFilterCount; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.openArray();
        else (flt.collector as JsonValueCollector).openArray();
      }
      for (let i = prevElColCount; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.openArray();
      }
    }

    if (incomingBranches.length === 0) {
      this.skipDepth = 1;
      this.updateSkipDecode();
      return;
    }

    // 3. Push array frame & attach any union groups / dynamic array collectors
    const frame: Frame = {
      type: "array",
      depth: this.frameStack.length + 1,
      activeBranches: incomingBranches,
      elementIndex: -1,
      pendingChildBranches: [],
      arrayCollectors: [],
      unionGroups: [],
    };
    this.frameStack.push(frame);
    this.initFrame(frame);
  }

  onclosearray() {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      if (this.skipDecode && this.activeFilters.length === 0) {
        this.feedRootCloseArray();
        if (!this.needsRootValue || this.rootReady) {
          this.flushPendingSlots();
        }
        if (this.skipDepth === 0) {
          this.updateSkipDecode();
          this.checkEarlyExit();
        }
        return;
      }
      this.advanceCloseArrayOnActive();
      this.feedRootCloseArray();
      this.updateSkipDecode();
      this.flushPendingSlots();
      this.checkEarlyExit();
      return;
    }

    const closedFrame = this.frameStack.pop();
    this.advanceCloseArrayOnActive();

    if (closedFrame) {
      if (closedFrame.arrayCollectors.length > 0) {
        for (let i = 0; i < closedFrame.arrayCollectors.length; i++) {
          this.finalizeArrayCollector(closedFrame.arrayCollectors[i]);
        }
      }
      if (closedFrame.unionGroups.length > 0) {
        this.finalizeUnionGroups(closedFrame);
      }
    }

    this.feedRootCloseArray();
    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceCloseArrayOnActive() {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.closeArray();
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.closeArray();
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.closeArray();
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.closeArray();
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }

  onkey(keyNode: string) {
    this.feedRootKey(keyNode);
    if (this.skipDepth > 0) {
      if (this.skipDecode) {
        return;
      }
      for (let i = 0; i < this.activeCaptures.length; i++) {
        this.activeCaptures[i].collector.key(keyNode);
      }
      for (let i = 0; i < this.activeFilters.length; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) flt.builder.key(keyNode);
        else (flt.collector as JsonValueCollector).key(keyNode);
      }
      for (let i = 0; i < this.activeElCollectors.length; i++) {
        this.activeElCollectors[i].currentElementCollector?.key(keyNode);
      }
      if (this.activeFilters.length > 0 || (this.needsRootValue && !this.rootReady)) {
        this.updateSkipDecode();
      }
      return;
    }

    for (let i = 0; i < this.activeCaptures.length; i++) {
      this.activeCaptures[i].collector.key(keyNode);
    }
    for (let i = 0; i < this.activeFilters.length; i++) {
      const flt = this.activeFilters[i];
      if (flt.builder) flt.builder.key(keyNode);
      else (flt.collector as JsonValueCollector).key(keyNode);
    }
    for (let i = 0; i < this.activeElCollectors.length; i++) {
      this.activeElCollectors[i].currentElementCollector?.key(keyNode);
    }

    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      this.handleObjectKey(top, keyNode);
    }
  }

  onvalue(valNode: string) {
    if (this.steps.length === 0 && !this.rootQueryHandled && this.trackPaths) {
      this.rootQueryHandled = true;
      this.emitResultString(formatResultPayload(this.resultType, [], valNode));
      return;
    }
    if (this.skipDepth > 0) {
      if (this.skipDecode && this.activeFilters.length === 0) {
        this.feedRootValue(valNode);
        if (this.rootReady) {
          this.flushPendingSlots();
        }
        return;
      }
      this.advanceValueOnActive(valNode);
      this.feedRootValue(valNode);
      this.updateSkipDecode();
      this.flushPendingSlots();
      return;
    }

    this.advanceValueOnActive(valNode);

    const top = this.frameStack[this.frameStack.length - 1];
    if (top && top.type === "object") {
      top.pendingChildBranches.length = 0;
    } else if (top && top.type === "array") {
      this.evaluateArrayElementSteps(top, true, valNode);
    }

    this.feedRootValue(valNode);
    this.updateSkipDecode();
    this.flushPendingSlots();
    this.checkEarlyExit();
  }

  private advanceValueOnActive(valNode: string) {
    const capLen = this.activeCaptures.length;
    if (capLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < capLen; i++) {
        const cap = this.activeCaptures[i];
        cap.collector.value(valNode);
        if (cap.collector.done) {
          this.finalizeCapture(cap);
        } else {
          this.activeCaptures[writeIdx++] = cap;
        }
      }
      this.activeCaptures.length = writeIdx;
    }

    const fltLen = this.activeFilters.length;
    if (fltLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < fltLen; i++) {
        const flt = this.activeFilters[i];
        if (flt.builder) {
          flt.builder.value(valNode);
          if (flt.builder.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        } else {
          const col = flt.collector as JsonValueCollector;
          col.value(valNode);
          if (col.done) {
            this.finalizeFilter(flt);
          } else {
            this.activeFilters[writeIdx++] = flt;
          }
        }
      }
      this.activeFilters.length = writeIdx;
    }

    const elLen = this.activeElCollectors.length;
    if (elLen > 0) {
      let writeIdx = 0;
      for (let i = 0; i < elLen; i++) {
        const ac = this.activeElCollectors[i];
        const col = ac.currentElementCollector as JsonValueCollector;
        col.value(valNode);
        if (col.done) {
          this.pushCollectedElement(ac, col.chunks.join(""));
          ac.currentElementCollector = null;
        } else {
          this.activeElCollectors[writeIdx++] = ac;
        }
      }
      this.activeElCollectors.length = writeIdx;
    }
  }
}
