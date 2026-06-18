/**
 * ============================================================================
 * CODE POLICE - BREAKING API CHANGE DETECTOR
 * ============================================================================
 * Flags when a Pull Request changes a module's *public API surface* in a way
 * that could break downstream callers — before a maintainer merges it.
 *
 * For every changed JS/TS source file we fetch the base and head versions,
 * extract the exported function / method / constructor signatures from each,
 * and diff them. A change is "breaking" when an existing caller, written
 * against the base version, would now fail to compile or behave differently:
 *
 *   - a removed (or renamed) export                     → callers reference a missing symbol
 *   - an arity reduction / removed parameter            → callers pass too many arguments
 *   - a parameter that was optional is now required     → callers omitting it now fail
 *   - a new required parameter                          → callers don't supply it
 *   - a changed parameter type                          → callers pass the wrong type
 *   - a changed return type                             → callers consume the wrong type
 *
 * Strategy mirrors the rest of the engine: pure, dependency-free, regex-level
 * signature extraction (no full TypeScript type inference). It is deliberately
 * conservative — it never throws on malformed input and only reports changes it
 * can see directly in the source text. Documented limits live next to each
 * extractor below.
 */

import { fetchFileContent } from "./github";

/** JS/TS source extensions whose signatures this engine understands. */
const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function isJsTsSource(path: string): boolean {
  if (/\.(min|d)\.(js|ts)$/.test(path)) return false;
  if (/^(node_modules|dist|build|\.next|out|coverage|vendor)\//.test(path)) return false;
  return JS_TS_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Signature model
// ---------------------------------------------------------------------------

export interface ParamSig {
  /** Declared name, a destructuring placeholder ("{…}"/"[…]"), or "" if unnamed. */
  name: string;
  /** TS type annotation, or null when untyped (plain JS or inferred). */
  type: string | null;
  /** True when the caller may legally omit this argument (`?`, default, or rest). */
  optional: boolean;
  /** True for a rest parameter (`...args`). */
  rest: boolean;
}

export type SignatureKind = "function" | "arrow" | "method" | "constructor";

export interface FunctionSig {
  /** "foo" for a top-level export, "MyClass.method" / "MyClass (constructor)" for members. */
  name: string;
  params: ParamSig[];
  /** TS return type annotation, or null when unannotated. */
  returnType: string | null;
  kind: SignatureKind;
}

export type BreakingKind =
  | "removed-export"
  | "removed-param"
  | "now-required-param"
  | "param-type-changed"
  | "return-type-changed";

export interface BreakingChange {
  /** The affected symbol (e.g. "parseConfig" or "Client.connect"). */
  symbol: string;
  kind: BreakingKind;
  /** Human-readable explanation of the change. */
  detail: string;
}

export interface FileBreakingChanges {
  path: string;
  changes: BreakingChange[];
}

export interface BreakingChangeReport {
  files: FileBreakingChanges[];
  /** Total breaking changes across all files. */
  total: number;
}

// ---------------------------------------------------------------------------
// Low-level scanning helpers (string/comment aware)
// ---------------------------------------------------------------------------

/**
 * Given the index of an opening `(` in `src`, return the index of its matching
 * `)`, skipping nested parens, string/template literals and comments. Returns
 * -1 if unbalanced. Used to capture a complete parameter list even when it
 * contains default values like `= ")"` or nested call expressions.
 */
function matchParen(src: string, openIdx: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (str !== null) {
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** As {@link matchParen} but for `{ }` blocks (e.g. a class or function body). */
function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (str !== null) {
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Read an optional `: ReturnType` immediately following a parameter list's
 * closing paren. Stops at the function/arrow body (`{` or `=>`) or a statement
 * terminator, respecting nested generics, parens, brackets, braces and strings.
 * Returns the trimmed type text (or null) and the index where scanning stopped.
 */
function readReturnType(src: string, afterParenIdx: number): { type: string | null; nextIdx: number } {
  let i = afterParenIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== ":") return { type: null, nextIdx: i };
  i++; // consume ':'
  const start = i;
  let angle = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let str: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (str !== null) {
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    const flat = angle === 0 && paren === 0 && bracket === 0 && brace === 0;
    if (flat) {
      if (c === "=" && src[i + 1] === ">") break;
      if (c === "{" || c === ";" || c === ",") break;
    }
    if (c === "<") angle++;
    else if (c === ">") {
      if (angle > 0) angle--;
    } else if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
  }
  const type = src.slice(start, i).trim();
  return { type: type.length ? type : null, nextIdx: i };
}

/** Split a parameter-list body on top-level commas (bracket/quote aware). */
function splitTopLevel(paramBody: string): string[] {
  const parts: string[] = [];
  let depthA = 0; // ()
  let depthB = 0; // []
  let depthC = 0; // {}
  let depthD = 0; // <>
  let str: string | null = null;
  let buf = "";
  for (let i = 0; i < paramBody.length; i++) {
    const c = paramBody[i];
    const prev = i > 0 ? paramBody[i - 1] : "";
    if (str !== null) {
      buf += c;
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      buf += c;
      continue;
    }
    if (c === "(") depthA++;
    else if (c === ")") depthA--;
    else if (c === "[") depthB++;
    else if (c === "]") depthB--;
    else if (c === "{") depthC++;
    else if (c === "}") depthC--;
    else if (c === "<") depthD++;
    else if (c === ">" && depthD > 0) depthD--;
    if (c === "," && depthA === 0 && depthB === 0 && depthC === 0 && depthD === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim().length) parts.push(buf);
  return parts;
}

const PARAM_MODIFIERS = /^(?:public|private|protected|readonly)\s+/;

/** Parse a single parameter declaration into a {@link ParamSig}. */
function parseParam(raw: string): ParamSig | null {
  let s = raw.trim();
  if (!s) return null;

  const rest = s.startsWith("...");
  if (rest) s = s.slice(3).trim();

  // Strip TS parameter-property / readonly modifiers (constructor params).
  while (PARAM_MODIFIERS.test(s)) s = s.replace(PARAM_MODIFIERS, "");

  // Separate name(+`?`) from `: type` and `= default` at top level.
  let depthA = 0;
  let depthB = 0;
  let depthC = 0;
  let depthD = 0;
  let str: string | null = null;
  let colon = -1;
  let eq = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : "";
    if (str !== null) {
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "(") depthA++;
    else if (c === ")") depthA--;
    else if (c === "[") depthB++;
    else if (c === "]") depthB--;
    else if (c === "{") depthC++;
    else if (c === "}") depthC--;
    else if (c === "<") depthD++;
    else if (c === ">" && depthD > 0) depthD--;
    const flat = depthA === 0 && depthB === 0 && depthC === 0 && depthD === 0;
    if (flat && colon === -1 && c === ":") colon = i;
    if (flat && eq === -1 && c === "=" && s[i + 1] !== ">" && prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">") eq = i;
  }

  const namePart = (colon >= 0 ? s.slice(0, colon) : eq >= 0 ? s.slice(0, eq) : s).trim();
  let typePart: string | null = null;
  if (colon >= 0) {
    const end = eq >= 0 && eq > colon ? eq : s.length;
    typePart = s.slice(colon + 1, end).trim() || null;
  }
  const hasDefault = eq >= 0;
  const optionalMark = /\?\s*$/.test(namePart);

  let name: string;
  if (namePart.startsWith("{")) name = "{…}";
  else if (namePart.startsWith("[")) name = "[…]";
  else name = namePart.replace(/\?\s*$/, "").trim();

  return {
    name,
    type: typePart,
    optional: rest || hasDefault || optionalMark,
    rest,
  };
}

function parseParamList(paramBody: string): ParamSig[] {
  const params: ParamSig[] = [];
  for (const part of splitTopLevel(paramBody)) {
    const p = parseParam(part);
    if (p) params.push(p);
  }
  return params;
}

// ---------------------------------------------------------------------------
// Signature extraction
// ---------------------------------------------------------------------------

const FN_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "constructor",
  "do",
  "else",
]);

/**
 * Extract exported function / arrow / class-member signatures from a source
 * file. Best-effort and regex-driven, consistent with the dependency graph's
 * extractors.
 *
 * Captures:
 *   - `export [default] [async] function name(...) : T`
 *   - `export [default] const|let|var name = [async] (...) : T =>` / `function`
 *   - public methods + constructor of `export [default] class Name { ... }`
 *
 * Documented limits: TS overload signatures collapse to their last form;
 * `#private` and `private`/`protected` members are intentionally ignored (not
 * public API); computed member names (`[expr]()`) are skipped; deeply
 * destructured parameters are recorded positionally with a placeholder name.
 */
export function extractSignatures(source: string): FunctionSig[] {
  const sigs: FunctionSig[] = [];
  sigs.push(...extractTopLevelFunctions(source));
  sigs.push(...extractExportedVariableFunctions(source));
  sigs.push(...extractExportedClassMembers(source));

  // De-duplicate by name+kind, keeping the first occurrence (handles a symbol
  // matched by more than one pass, e.g. overloads).
  const seen = new Set<string>();
  return sigs.filter((s) => {
    const key = `${s.kind}:${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractTopLevelFunctions(source: string): FunctionSig[] {
  const out: FunctionSig[] = [];
  // export [default] [async] function [*] name <...> (
  const re = /\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^=<>]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // `export default function foo()` is always keyed "default" — consumers import
    // it as the default export regardless of the internal function name. Renaming
    // the internal name only is not a breaking change.
    const name = /\bdefault\b/.test(m[0]) ? "default" : (m[1] ?? "default");
    const openIdx = source.indexOf("(", m.index + m[0].length - 1);
    if (openIdx === -1) continue;
    const close = matchParen(source, openIdx);
    if (close === -1) continue;
    const params = parseParamList(source.slice(openIdx + 1, close));
    const { type } = readReturnType(source, close + 1);
    out.push({ name, params, returnType: type, kind: "function" });
  }
  return out;
}

function extractExportedVariableFunctions(source: string): FunctionSig[] {
  const out: FunctionSig[] = [];
  // export [default] const|let|var name [: T] = [async] ...
  const re = /\bexport\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\s+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    let i = m.index + m[0].length;
    while (i < source.length && /\s/.test(source[i])) i++;

    // `= function [name] <...> (`  — use the fnMatch result to locate the `(`
    // precisely rather than re-scanning with indexOf (which could land on a `(`
    // inside a generic parameter list or a default value in a prior argument).
    const fnMatch = /^function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(?:<[^=<>]*>)?\s*\(/.exec(source.slice(i));
    if (fnMatch) {
      const openIdx = i + fnMatch[0].length - 1; // fnMatch[0] ends with "("
      const close = matchParen(source, openIdx);
      if (close !== -1) {
        const params = parseParamList(source.slice(openIdx + 1, close));
        const { type } = readReturnType(source, close + 1);
        out.push({ name, params, returnType: type, kind: "arrow" });
        continue;
      }
    }

    // Skip an optional generic param list `<...>` before an arrow.
    if (source[i] === "<") {
      let angle = 0;
      for (; i < source.length; i++) {
        if (source[i] === "<") angle++;
        else if (source[i] === ">") {
          angle--;
          if (angle === 0) {
            i++;
            break;
          }
        }
      }
      while (i < source.length && /\s/.test(source[i])) i++;
    }

    // `= (params) [: T] =>`
    if (source[i] === "(") {
      const close = matchParen(source, i);
      if (close === -1) continue;
      const rt = readReturnType(source, close + 1);
      // Confirm an arrow follows, otherwise this is an ordinary call/paren expr.
      const after = source.slice(rt.nextIdx).trimStart();
      if (after.startsWith("=>")) {
        const params = parseParamList(source.slice(i + 1, close));
        out.push({ name, params, returnType: rt.type, kind: "arrow" });
      }
      continue;
    }

    // `= singleArg =>` (parenless single-parameter arrow)
    const single = /^([A-Za-z_$][\w$]*)\s*=>/.exec(source.slice(i));
    if (single) {
      out.push({
        name,
        params: [{ name: single[1], type: null, optional: false, rest: false }],
        returnType: null,
        kind: "arrow",
      });
    }
  }
  return out;
}

function extractExportedClassMembers(source: string): FunctionSig[] {
  const out: FunctionSig[] = [];
  const re = /\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const className = m[1];
    const braceIdx = source.indexOf("{", m.index + m[0].length);
    if (braceIdx === -1) continue;
    const bodyEnd = matchBrace(source, braceIdx);
    if (bodyEnd === -1) continue;
    const body = source.slice(braceIdx + 1, bodyEnd);
    out.push(...extractClassBodyMembers(className, body));
  }
  return out;
}

const MEMBER_MODIFIER = /^(?:public|private|protected|static|abstract|readonly|override|declare|async|get|set)\b/;

function extractClassBodyMembers(className: string, body: string): FunctionSig[] {
  const out: FunctionSig[] = [];
  let i = 0;
  const len = body.length;

  while (i < len) {
    // Skip whitespace and comments between members.
    if (/\s/.test(body[i])) {
      i++;
      continue;
    }
    if (body[i] === "/" && body[i + 1] === "/") {
      const nl = body.indexOf("\n", i);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (body[i] === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (body[i] === "@") {
      // Skip a decorator (and its optional call args).
      i++;
      while (i < len && /[\w$.]/.test(body[i])) i++;
      if (body[i] === "(") {
        const c = matchParen(body, i);
        i = c === -1 ? len : c + 1;
      }
      continue;
    }

    // Read modifier keywords, remembering visibility.
    let isPrivate = false;
    for (;;) {
      const mm = MEMBER_MODIFIER.exec(body.slice(i));
      if (!mm) break;
      if (mm[0] === "private" || mm[0] === "protected") isPrivate = true;
      i += mm[0].length;
      while (i < len && /\s/.test(body[i])) i++;
    }

    // Optional generator star.
    if (body[i] === "*") {
      i++;
      while (i < len && /\s/.test(body[i])) i++;
    }

    // Member name. `#private`, computed `[..]` and string names are skipped.
    if (body[i] === "#") {
      isPrivate = true;
      i++;
    }
    const nameMatch = /^[A-Za-z_$][\w$]*/.exec(body.slice(i));
    if (!nameMatch) {
      // Computed/string member or something unparseable — skip to next ; or } edge.
      i = skipToMemberEnd(body, i);
      continue;
    }
    const memberName = nameMatch[0];
    let j = i + memberName.length;
    while (j < len && /\s/.test(body[j])) j++;

    // Optional `?`/`!` then generics before a method's `(`.
    if (body[j] === "?" || body[j] === "!") {
      j++;
      while (j < len && /\s/.test(body[j])) j++;
    }
    if (body[j] === "<") {
      let angle = 0;
      for (; j < len; j++) {
        if (body[j] === "<") angle++;
        else if (body[j] === ">") {
          angle--;
          if (angle === 0) {
            j++;
            break;
          }
        }
      }
      while (j < len && /\s/.test(body[j])) j++;
    }

    if (body[j] === "(" && !FN_KEYWORDS.has(memberName.toLowerCase() === memberName ? "" : memberName)) {
      // Method (or constructor) signature.
      const close = matchParen(body, j);
      if (close === -1) {
        i = len;
        continue;
      }
      const params = parseParamList(body.slice(j + 1, close));
      const rt = readReturnType(body, close + 1);
      if (!isPrivate) {
        if (memberName === "constructor") {
          out.push({ name: `${className} (constructor)`, params, returnType: null, kind: "constructor" });
        } else {
          out.push({ name: `${className}.${memberName}`, params, returnType: rt.type, kind: "method" });
        }
      }
      // Advance past the body `{...}` or the `;` of an abstract/overload member.
      let k = rt.nextIdx;
      while (k < len && /\s/.test(body[k])) k++;
      if (body[k] === "{") {
        const be = matchBrace(body, k);
        i = be === -1 ? len : be + 1;
      } else {
        i = skipToMemberEnd(body, k);
      }
      continue;
    }

    // Property — may be an arrow-function property (`name = (..) => ..`).
    if (body[j] === "=" && body[j + 1] !== "=") {
      let k = j + 1;
      while (k < len && /\s/.test(body[k])) k++;
      if (body.slice(k).startsWith("async")) {
        k += 5;
        while (k < len && /\s/.test(body[k])) k++;
      }
      if (body[k] === "(") {
        const close = matchParen(body, k);
        if (close !== -1) {
          const rt = readReturnType(body, close + 1);
          const after = body.slice(rt.nextIdx).trimStart();
          if (after.startsWith("=>") && !isPrivate) {
            out.push({
              name: `${className}.${memberName}`,
              params: parseParamList(body.slice(k + 1, close)),
              returnType: rt.type,
              kind: "method",
            });
          }
        }
      }
    }

    // Skip the rest of this member declaration.
    i = skipToMemberEnd(body, j);
  }

  return out;
}

/** Advance past the current member to just after its terminating `;` or block. */
function skipToMemberEnd(body: string, from: number): number {
  let i = from;
  const len = body.length;
  let str: string | null = null;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  for (; i < len; i++) {
    const c = body[i];
    const prev = i > 0 ? body[i - 1] : "";
    if (str !== null) {
      if (c === str && prev !== "\\") str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      const nl = body.indexOf("\n", i);
      if (nl === -1) return len;
      i = nl;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      if (end === -1) return len;
      i = end + 1;
      continue;
    }
    if (c === "{") brace++;
    else if (c === "}") {
      if (brace === 0) return i; // hit end of class body
      brace--;
    } else if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    if (c === ";" && brace === 0 && paren === 0 && bracket === 0) return i + 1;
  }
  return len;
}

// ---------------------------------------------------------------------------
// Signature diffing
// ---------------------------------------------------------------------------

/** Number of parameters a caller MUST supply (everything up to the first optional). */
function requiredArity(params: ParamSig[]): number {
  let count = 0;
  for (const p of params) {
    if (p.optional || p.rest) break;
    count++;
  }
  return count;
}

function hasRest(params: ParamSig[]): boolean {
  return params.some((p) => p.rest);
}

/**
 * Diff two sets of signatures (base → head) and return the breaking changes.
 * Symbols are matched by `name`. A symbol present in base but absent in head is
 * a removed export. For surviving symbols we compare arity, per-position
 * optionality and TS type annotations.
 */
export function diffSignatures(base: FunctionSig[], head: FunctionSig[]): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const headByName = new Map<string, FunctionSig>();
  for (const s of head) headByName.set(s.name, s);

  for (const b of base) {
    const h = headByName.get(b.name);

    if (!h) {
      changes.push({
        symbol: b.name,
        kind: "removed-export",
        detail: `\`${b.name}\` was a public export on the base branch but is no longer exported (removed or renamed).`,
      });
      continue;
    }

    const baseReq = requiredArity(b.params);
    const headReq = requiredArity(h.params);
    const headMax = h.params.length;
    const headAcceptsExtra = hasRest(h.params);

    // Arity reduction: a call that passed N args may now be too many.
    if (!headAcceptsExtra && headMax < b.params.length) {
      changes.push({
        symbol: b.name,
        kind: "removed-param",
        detail: `\`${b.name}\` dropped ${b.params.length - headMax} parameter(s) (was ${b.params.length}, now ${headMax}); existing calls may pass too many arguments.`,
      });
    }

    // Newly-required parameters: callers that omitted them now fail.
    if (headReq > baseReq) {
      changes.push({
        symbol: b.name,
        kind: "now-required-param",
        detail: `\`${b.name}\` now requires ${headReq} argument(s) (was ${baseReq}); callers omitting the new required parameter(s) will break.`,
      });
    }

    // Per-position parameter type changes (only when both sides annotate).
    const shared = Math.min(b.params.length, h.params.length);
    for (let i = 0; i < shared; i++) {
      const bp = b.params[i];
      const hp = h.params[i];
      if (bp.type && hp.type && normalizeType(bp.type) !== normalizeType(hp.type)) {
        changes.push({
          symbol: b.name,
          kind: "param-type-changed",
          detail: `\`${b.name}\` parameter ${i + 1}${hp.name ? ` (\`${hp.name}\`)` : ""} type changed from \`${bp.type}\` to \`${hp.type}\`.`,
        });
      }
    }

    // Return type change.
    if (b.returnType && h.returnType && normalizeType(b.returnType) !== normalizeType(h.returnType)) {
      changes.push({
        symbol: b.name,
        kind: "return-type-changed",
        detail: `\`${b.name}\` return type changed from \`${b.returnType}\` to \`${h.returnType}\`.`,
      });
    }
  }

  return changes;
}

/** Collapse insignificant whitespace so `string|null` === `string | null`. */
function normalizeType(t: string): string {
  return t.replace(/\s+/g, " ").replace(/\s*([|&,<>()[\]{}:?])\s*/g, "$1").trim();
}

// ---------------------------------------------------------------------------
// Orchestration (thin fetch wrapper) + reporting
// ---------------------------------------------------------------------------

const MAX_CHANGED_FILES = 60; // bound API usage

/** Lightweight helper: fetch a GitHub API endpoint as JSON with Bearer auth. */
async function ghApiJson<T>(token: string, url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const GITHUB_API_BASE_BC = "https://api.github.com";

interface AnalysisTarget {
  path: string;
  /** True when the PR deletes this file — head is intentionally absent. */
  isDeleted: boolean;
}

/**
 * Analyse breaking changes introduced by a PR.
 *
 * Accepts the caller-supplied `changedFiles` (added/modified paths) and, when
 * `prNumber` is provided, also fetches the full PR file list so **deleted**
 * files are included — their removed exports are the highest-impact breaking
 * case and were previously missed because callers strip `status:"removed"`
 * entries before building `changedFiles`.
 *
 * Fetch-error handling:
 * - Base 404 (new file): treated as empty — no prior API surface to break.
 * - Head failure on a **non-deleted** file (transient error / rate-limit):
 *   the file is **skipped** rather than diffed against an empty string, which
 *   would generate false "all exports removed" reports.
 * - Deleted files: head is empty by design; only base is fetched.
 */
export async function analyzeBreakingChanges(opts: {
  githubToken: string;
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  changedFiles: string[];
  /** When supplied, the PR file list is fetched to recover deleted files. */
  prNumber?: number;
}): Promise<BreakingChangeReport> {
  const { githubToken, owner, repo, baseBranch, branch, prNumber } = opts;

  // Start with caller-supplied added/modified files.
  const targets: AnalysisTarget[] = opts.changedFiles
    .filter(isJsTsSource)
    .map((path) => ({ path, isDeleted: false }));

  // Recover deleted files that upstream callers strip before passing changedFiles.
  if (prNumber) {
    const prFiles = await ghApiJson<Array<{ filename: string; status: string }>>(
      githubToken,
      `${GITHUB_API_BASE_BC}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
    );
    if (prFiles) {
      const already = new Set(targets.map((t) => t.path));
      for (const f of prFiles) {
        if (f.status === "removed" && isJsTsSource(f.filename) && !already.has(f.filename)) {
          targets.push({ path: f.filename, isDeleted: true });
        }
      }
    }
  }

  const files: FileBreakingChanges[] = [];

  for (const { path, isDeleted } of targets.slice(0, MAX_CHANGED_FILES)) {
    // Base: 404 = brand-new file (no prior API) → treat as empty.
    const baseContent = await fetchFileContent(githubToken, owner, repo, path, baseBranch).catch(
      () => ""
    );

    let headContent: string;
    if (isDeleted) {
      // Deleted file: head is absent by design.
      headContent = "";
    } else {
      // Modified/added: a fetch failure is a transient error, not "file has
      // no exports". Skip the file to avoid false removed-export reports.
      const headResult = await fetchFileContent(githubToken, owner, repo, path, branch).catch(
        () => null
      );
      if (headResult === null) continue;
      headContent = headResult;
    }

    if (!baseContent && !headContent) continue;

    const baseSigs = baseContent ? extractSignatures(baseContent) : [];
    const headSigs = headContent ? extractSignatures(headContent) : [];
    const changes = diffSignatures(baseSigs, headSigs);
    if (changes.length > 0) files.push({ path, changes });
  }

  const total = files.reduce((acc, f) => acc + f.changes.length, 0);
  return { files, total };
}

const KIND_LABEL: Record<BreakingKind, string> = {
  "removed-export": "Removed export",
  "removed-param": "Removed parameter",
  "now-required-param": "New required parameter",
  "param-type-changed": "Parameter type changed",
  "return-type-changed": "Return type changed",
};

/**
 * Render a breaking-change report as a Markdown PR-comment section. Returns the
 * empty string when there are no breaking changes, so callers can append it
 * unconditionally (matching `formatCyclesComment`).
 */
export function formatBreakingChangesComment(report: BreakingChangeReport): string {
  if (report.total === 0) return "";

  const lines: string[] = [
    "## 🚧 Breaking API Changes",
    "",
    `🔴 **${report.total}** potential breaking change${report.total === 1 ? "" : "s"} to the public API surface. ` +
      "Downstream callers written against the base branch may need updating.",
  ];

  for (const file of report.files.slice(0, 15)) {
    lines.push("", `### \`${file.path}\``, "", "| Symbol | Change | Detail |", "| --- | --- | --- |");
    for (const c of file.changes.slice(0, 25)) {
      lines.push(`| \`${c.symbol}\` | ${KIND_LABEL[c.kind]} | ${escapeCell(c.detail)} |`);
    }
  }

  if (report.files.length > 15) {
    lines.push("", `_…and breaking changes in ${report.files.length - 15} more file(s)._`);
  }

  return lines.join("\n");
}

/** Escape a string for safe use inside a single Markdown table cell. */
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
