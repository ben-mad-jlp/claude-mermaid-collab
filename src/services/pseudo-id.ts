/**
 * Pseudo ID Service
 *
 * Deterministic method identity and body fingerprinting for pseudocode indexing.
 *
 * - computeMethodId: SHA1(file::class::name::normalized_params) → 'm_' + 8 hex chars
 * - normalizeParams: canonical param-type signature for stable identity
 * - computeBodyFingerprint: order-independent bag-of-words hash of body identifiers
 */

import { createHash } from 'crypto';

export interface MethodIdentity {
  file_path: string;
  enclosing_class: string | null;
  name: string;
  normalized_params: string;
}

const STOP_WORDS: Set<string> = new Set([
  'this', 'self', 'return', 'if', 'else', 'for', 'while',
  'const', 'let', 'var', 'function', 'def', 'async', 'await',
  'new', 'null', 'undefined', 'true', 'false',
  'throw', 'try', 'catch', 'finally', 'break', 'continue',
]);

const PARAM_MODIFIERS: Set<string> = new Set([
  'public', 'private', 'protected', 'readonly', 'static',
  'override', 'abstract', 'async',
]);

const JS_KEYWORDS: Set<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'enum', 'await', 'async', 'of', 'as',
  'def', 'lambda', 'pass', 'elif', 'from', 'global', 'nonlocal',
  'is', 'not', 'and', 'or', 'None', 'True', 'False',
]);

const MAX_FINGERPRINT_IDENTIFIERS = 500;

export function computeMethodId(m: MethodIdentity): string {
  const normalizedPath = normalizeFilePath(m.file_path);
  const key = [
    normalizedPath,
    m.enclosing_class ?? '',
    m.name,
    m.normalized_params,
  ].join('::');
  const hash = createHash('sha1').update(key).digest('hex');
  return 'm_' + hash.slice(0, 8);
}

export function normalizeParams(rawParams: string): string {
  let s = (rawParams ?? '').trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1);
  }
  s = s.trim();
  if (s.length === 0) return '';

  const parts = splitTopLevelCommas(s);
  const normalized = parts.map((part) => canonicalizeParam(part));
  return normalized.join(',');
}

export function computeBodyFingerprint(methodBody: string): string {
  const body = methodBody ?? '';
  if (body.trim().length === 0) {
    return 'h_empty___';
  }

  const tokens = tokenizeIdentifiers(body);
  const unique = new Set<string>(tokens);

  const filtered: string[] = [];
  for (const t of unique) {
    if (STOP_WORDS.has(t)) continue;
    if (JS_KEYWORDS.has(t)) continue;
    filtered.push(t);
  }

  if (filtered.length === 0) {
    return 'h_empty___';
  }

  filtered.sort();
  const capped = filtered.length > MAX_FINGERPRINT_IDENTIFIERS
    ? filtered.slice(0, MAX_FINGERPRINT_IDENTIFIERS)
    : filtered;

  const hash = createHash('sha1').update(capped.join(' ')).digest('hex');
  return 'h_' + hash.slice(0, 8);
}

function normalizeFilePath(filePath: string): string {
  let p = (filePath ?? '').replace(/\\/g, '/');
  while (p.startsWith('./')) {
    p = p.slice(2);
  }
  return p;
}

function splitTopLevelCommas(s: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;
  let prev = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
      prev = ch;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      prev = ch;
      continue;
    }

    if (ch === '<' || ch === '[' || ch === '{' || ch === '(') {
      depth++;
    } else if (ch === '>' || ch === ']' || ch === '}' || ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ',' && depth === 0) {
      result.push(s.slice(start, i));
      start = i + 1;
    }
    prev = ch;
  }
  const tail = s.slice(start);
  if (tail.trim().length > 0 || result.length > 0) {
    result.push(tail);
  }
  return result.filter((p) => p.trim().length > 0);
}

function canonicalizeParam(rawParam: string): string {
  let p = rawParam.trim();
  if (p.length === 0) return 'any';

  if (p.startsWith('...')) {
    p = p.slice(3).trim();
  }

  while (true) {
    const spaceIdx = p.indexOf(' ');
    if (spaceIdx < 0) break;
    const head = p.slice(0, spaceIdx);
    if (PARAM_MODIFIERS.has(head)) {
      p = p.slice(spaceIdx + 1).trim();
      continue;
    }
    break;
  }

  const eqIdx = findTopLevelAssign(p);
  if (eqIdx >= 0) {
    p = p.slice(0, eqIdx).trim();
  }

  const colonIdx = findTopLevelColon(p);
  let typePart: string;
  if (colonIdx >= 0) {
    typePart = p.slice(colonIdx + 1).trim();
    typePart = typePart.replace(/[;,]\s*$/, '').trim();
  } else {
    typePart = 'any';
  }

  if (typePart.length === 0) typePart = 'any';
  typePart = typePart.replace(/\s+/g, ' ');
  return typePart;
}

function findTopLevelAssign(s: string): number {
  let depth = 0;
  let inString: string | null = null;
  let prev = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      prev = ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; prev = ch; continue; }
    if (ch === '<' || ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === ']' || ch === '}' || ch === ')') { if (depth > 0) depth--; }
    else if (ch === '=' && depth === 0) {
      const next = s[i + 1];
      if (next === '=' || next === '>') { prev = ch; continue; }
      if (prev === '=' || prev === '!' || prev === '<' || prev === '>') { prev = ch; continue; }
      return i;
    }
    prev = ch;
  }
  return -1;
}

function findTopLevelColon(s: string): number {
  let depth = 0;
  let inString: string | null = null;
  let prev = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      prev = ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; prev = ch; continue; }
    if (ch === '<' || ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === '>' || ch === ']' || ch === '}' || ch === ')') { if (depth > 0) depth--; }
    else if (ch === ':' && depth === 0) {
      if (prev === ':' || s[i + 1] === ':') { prev = ch; continue; }
      return i;
    }
    prev = ch;
  }
  return -1;
}

function tokenizeIdentifiers(body: string): string[] {
  const stripped = stripStringsAndComments(body);
  const tokens: string[] = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

function stripStringsAndComments(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    const next = s[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && s[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === '#') {
      while (i < n && s[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
