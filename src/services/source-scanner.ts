/**
 * Source Scanner — regex-based structural analysis of source code files.
 *
 * For every supported source file, extracts the list of functions/methods
 * with their line numbers, signatures, visibility, async flag, and kind.
 * No LLM cost. Used by Phase 6's Level 1 indexing pipeline.
 *
 * Language coverage:
 * - TypeScript / JavaScript: primary (full support for functions, arrow,
 *   function expressions, class methods, getters/setters, constructors).
 * - C#: good-effort (class methods with visibility modifiers).
 * - C++: good-effort (free functions + `Foo::bar` qualified methods).
 * - Python: def / async def with indentation-based class tracking.
 *
 * Never throws; returns null on unsupported or unreadable files.
 */

import { statSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { extname } from 'path';
import type { StructuralMethod, ScanResult } from './pseudo-db.js';

export type { StructuralMethod, ScanResult };

const MAX_FILE_BYTES = 1_000_000;

const SUPPORTED_EXTS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
};

export function isSupportedExtension(ext: string): boolean {
  return ext.toLowerCase() in SUPPORTED_EXTS;
}

/**
 * Depth-aware parameter counter.
 *
 * Walks the param-list string char-by-char, tracks depth of `<`, `(`, `{`, `[`
 * (and their closers), tracks string state for `'`, `"`, `` ` ``, and counts
 * top-level commas + 1 (if non-empty after trim). Handles backslash escapes in
 * quoted strings.
 */
export function countParams(params: string): number {
  const trimmed = params.trim();
  if (!trimmed) return 0;

  // Walk the string, splitting on top-level commas, and count non-empty
  // segments. Handles generics `<...>`, parens `(...)`, objects `{...}`,
  // arrays `[...]`, string literals (with backslash escapes), and trailing
  // commas in the param list.
  let depth = 0;
  let segmentHasContent = false;
  let segments = 0;
  let inString: "'" | '"' | '`' | null = null;

  const finishSegment = () => {
    if (segmentHasContent) segments++;
    segmentHasContent = false;
  };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inString) {
      segmentHasContent = true;
      if (ch === '\\') {
        i++; // skip escaped char
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch as "'" | '"' | '`';
      segmentHasContent = true;
      continue;
    }

    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') {
      depth++;
      segmentHasContent = true;
      continue;
    }
    if (ch === '>' || ch === ')' || ch === '}' || ch === ']') {
      if (depth > 0) depth--;
      segmentHasContent = true;
      continue;
    }

    if (ch === ',' && depth === 0) {
      finishSegment();
      continue;
    }

    if (!/\s/.test(ch)) {
      segmentHasContent = true;
    }
  }

  finishSegment();
  return segments;
}

export function scanSourceFile(absPath: string): ScanResult | null {
  try {
    const stat = statSync(absPath);
    if (stat.size > MAX_FILE_BYTES) return null;

    const ext = extname(absPath).toLowerCase();
    const language = SUPPORTED_EXTS[ext];
    if (!language) return null;

    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    let methods: StructuralMethod[];
    switch (language) {
      case 'typescript':
      case 'javascript':
        methods = scanTypeScript(lines);
        break;
      case 'csharp':
        methods = scanCSharp(lines);
        break;
      case 'cpp':
        methods = scanCpp(lines);
        break;
      case 'python':
        methods = scanPython(lines);
        break;
      default:
        methods = [];
    }

    const sourceHash = createHash('sha1').update(content).digest('hex').slice(0, 16);

    return {
      language,
      methods,
      lineCount: lines.length,
      sourceHash,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// TypeScript / JavaScript
// ============================================================================

const TS_FUNCTION_DECL_RE = /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?\s*\{?/;
const TS_ARROW_RE = /^(\s*)(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(([^)]*)\)(?:\s*:\s*([^={]+))?\s*=>/;
const TS_FUNC_EXPR_RE = /^(\s*)(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?function\s*\*?\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?\s*\{?/;
const TS_CLASS_DECL_RE = /^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
const TS_CLASS_METHOD_RE = /^(\s*)((?:public|private|protected|static|async|override|readonly|\s)*?)\s*(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?\s*\{/;
const TS_CLASS_GETSET_RE = /^(\s*)((?:public|private|protected|static|\s)*)\s*(get|set)\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?\s*\{/;

// ---- Multi-line fallback "start of decl" patterns (no closing `)` required) ----
// These match the opening of a decl up to and including the `(` so that
// captureMultiLineSignature can take over for params/return type/brace.
const TS_FUNCTION_DECL_START_RE = /^(\s*)(export\s+)?(async\s+)?function\s+(\w+)\s*\(/;
const TS_CLASS_METHOD_START_RE = /^(\s*)((?:public|private|protected|static|async|override|readonly|\s)*?)\s*(\w+)\s*\(/;
const TS_CLASS_GETSET_START_RE = /^(\s*)((?:public|private|protected|static|\s)*)\s*(get|set)\s+(\w+)\s*\(/;
const TS_ARROW_START_RE = /^(\s*)(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(/;
const TS_FUNC_EXPR_START_RE = /^(\s*)(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?function\s*\*?\s*\(/;

function scanTypeScript(lines: string[]): StructuralMethod[] {
  const results: StructuralMethod[] = [];
  const classStack: Array<{ name: string; openDepth: number }> = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pop class stack entries whose block has closed before this line
    while (classStack.length > 0 && braceDepth < classStack[classStack.length - 1].openDepth) {
      classStack.pop();
    }

    try {
      const owning = classStack.length > 0 ? classStack[classStack.length - 1].name : null;

      // 1. Class declaration — push onto stack, don't emit a method
      const classMatch = TS_CLASS_DECL_RE.exec(line);
      if (classMatch) {
        classStack.push({ name: classMatch[2], openDepth: braceDepth + 1 });
        braceDepth += countBraceDelta(line);
        continue;
      }

      // 2. Function declaration
      let m = TS_FUNCTION_DECL_RE.exec(line);
      if (m) {
        const params = (m[5] ?? '').trim();
        results.push({
          name: m[4],
          params,
          paramCount: countParams(params),
          returnType: trimReturnType(m[6]),
          isExported: !!m[2],
          isAsync: !!m[3],
          visibility: null,
          kind: 'function',
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          owningSymbol: owning,
        });
        braceDepth += countBraceDelta(line);
        continue;
      }

      // 3. Arrow function assigned to variable
      m = TS_ARROW_RE.exec(line);
      if (m) {
        const params = (m[5] ?? '').trim();
        results.push({
          name: m[3],
          params,
          paramCount: countParams(params),
          returnType: trimReturnType(m[6]),
          isExported: !!m[2],
          isAsync: !!m[4],
          visibility: null,
          kind: 'callback',
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          owningSymbol: owning,
        });
        braceDepth += countBraceDelta(line);
        continue;
      }

      // 4. Function expression assigned to variable
      m = TS_FUNC_EXPR_RE.exec(line);
      if (m) {
        const params = (m[5] ?? '').trim();
        results.push({
          name: m[3],
          params,
          paramCount: countParams(params),
          returnType: trimReturnType(m[6]),
          isExported: !!m[2],
          isAsync: !!m[4],
          visibility: null,
          kind: 'function',
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          owningSymbol: owning,
        });
        braceDepth += countBraceDelta(line);
        continue;
      }

      // Class-only patterns (getter/setter, method, constructor)
      if (classStack.length > 0) {
        // 5. Getter / setter
        m = TS_CLASS_GETSET_RE.exec(line);
        if (m) {
          const visibility = parseVisibility(m[2]);
          const params = (m[5] ?? '').trim();
          results.push({
            name: m[4],
            params,
            paramCount: countParams(params),
            returnType: trimReturnType(m[6]),
            isExported: false,
            isAsync: false,
            visibility,
            kind: m[3] === 'get' ? 'getter' : 'setter',
            sourceLine: i + 1,
            sourceLineEnd: computeEndLine(lines, i),
            owningSymbol: owning,
          });
          braceDepth += countBraceDelta(line);
          continue;
        }

        // 6. Class method / constructor
        m = TS_CLASS_METHOD_RE.exec(line);
        if (m) {
          const modifiers = m[2];
          const name = m[3];
          // Skip control keywords that pattern can match (if, for, while, switch, return, etc)
          if (['if', 'for', 'while', 'switch', 'return', 'else', 'do', 'try', 'catch', 'throw', 'new'].includes(name)) {
            braceDepth += countBraceDelta(line);
            continue;
          }
          const visibility = parseVisibility(modifiers);
          const isAsync = /\basync\b/.test(modifiers);
          const kind = name === 'constructor' ? 'constructor' : 'method';
          const params = (m[4] ?? '').trim();
          results.push({
            name,
            params,
            paramCount: countParams(params),
            returnType: trimReturnType(m[5]),
            isExported: false,
            isAsync,
            visibility,
            kind,
            sourceLine: i + 1,
            sourceLineEnd: computeEndLine(lines, i),
            owningSymbol: owning,
          });
          braceDepth += countBraceDelta(line);
          continue;
        }
      }

      // ---- Multi-line fallback paths ----
      // These handle declarations whose closing `)` or opening `{` appears
      // on a later line than the start of the decl. Matched only if none
      // of the single-line regexes matched above.

      // 7. Multi-line function declaration
      let sm = TS_FUNCTION_DECL_START_RE.exec(line);
      if (sm) {
        const sig = captureMultiLineSignature(lines, i, sm[0].length);
        if (sig) {
          results.push({
            name: sm[4],
            params: sig.params,
            paramCount: countParams(sig.params),
            returnType: sig.returnType,
            isExported: !!sm[2],
            isAsync: !!sm[3],
            visibility: null,
            kind: 'function',
            sourceLine: i + 1,
            sourceLineEnd: computeEndLine(lines, sig.braceLine),
            owningSymbol: owning,
          });
          braceDepth += countBraceDelta(line);
          continue;
        }
      }

      // 8. Multi-line function expression
      sm = TS_FUNC_EXPR_START_RE.exec(line);
      if (sm) {
        const sig = captureMultiLineSignature(lines, i, sm[0].length);
        if (sig) {
          results.push({
            name: sm[3],
            params: sig.params,
            paramCount: countParams(sig.params),
            returnType: sig.returnType,
            isExported: !!sm[2],
            isAsync: !!sm[4],
            visibility: null,
            kind: 'function',
            sourceLine: i + 1,
            sourceLineEnd: computeEndLine(lines, sig.braceLine),
            owningSymbol: owning,
          });
          braceDepth += countBraceDelta(line);
          continue;
        }
      }

      // 9. Multi-line arrow function
      sm = TS_ARROW_START_RE.exec(line);
      if (sm) {
        const sig = captureMultiLineSignature(lines, i, sm[0].length);
        if (sig) {
          results.push({
            name: sm[3],
            params: sig.params,
            paramCount: countParams(sig.params),
            returnType: sig.returnType,
            isExported: !!sm[2],
            isAsync: !!sm[4],
            visibility: null,
            kind: 'callback',
            sourceLine: i + 1,
            sourceLineEnd: computeEndLine(lines, sig.braceLine),
            owningSymbol: owning,
          });
          braceDepth += countBraceDelta(line);
          continue;
        }
      }

      // 10. Multi-line class method / getter-setter (only inside a class)
      if (classStack.length > 0) {
        sm = TS_CLASS_GETSET_START_RE.exec(line);
        if (sm) {
          const sig = captureMultiLineSignature(lines, i, sm[0].length);
          if (sig) {
            results.push({
              name: sm[4],
              params: sig.params,
              paramCount: countParams(sig.params),
              returnType: sig.returnType,
              isExported: false,
              isAsync: false,
              visibility: parseVisibility(sm[2]),
              kind: sm[3] === 'get' ? 'getter' : 'setter',
              sourceLine: i + 1,
              sourceLineEnd: computeEndLine(lines, sig.braceLine),
              owningSymbol: owning,
            });
            braceDepth += countBraceDelta(line);
            continue;
          }
        }

        sm = TS_CLASS_METHOD_START_RE.exec(line);
        if (sm) {
          const modifiers = sm[2];
          const name = sm[3];
          if (['if', 'for', 'while', 'switch', 'return', 'else', 'do', 'try', 'catch', 'throw', 'new'].includes(name)) {
            braceDepth += countBraceDelta(line);
            continue;
          }
          const sig = captureMultiLineSignature(lines, i, sm[0].length);
          if (sig) {
            const visibility = parseVisibility(modifiers);
            const isAsync = /\basync\b/.test(modifiers);
            const kind = name === 'constructor' ? 'constructor' : 'method';
            results.push({
              name,
              params: sig.params,
              paramCount: countParams(sig.params),
              returnType: sig.returnType,
              isExported: false,
              isAsync,
              visibility,
              kind,
              sourceLine: i + 1,
              sourceLineEnd: computeEndLine(lines, sig.braceLine),
              owningSymbol: owning,
            });
            braceDepth += countBraceDelta(line);
            continue;
          }
        }
      }
    } catch {
      // Silently skip malformed lines
    }

    // No match — just update brace depth
    braceDepth += countBraceDelta(line);
  }

  // Sort by sourceLine for stable output
  results.sort((a, b) => a.sourceLine - b.sourceLine);
  return results;
}

function parseVisibility(modifiers: string): 'public' | 'private' | 'protected' | 'internal' | null {
  if (/\bprivate\b/.test(modifiers)) return 'private';
  if (/\bprotected\b/.test(modifiers)) return 'protected';
  if (/\binternal\b/.test(modifiers)) return 'internal';
  if (/\bpublic\b/.test(modifiers)) return 'public';
  return null;
}

function trimReturnType(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/[={;]\s*$/, '').trim();
}

// ============================================================================
// C# — good-effort
// ============================================================================

const CS_CLASS_DECL_RE = /^(\s*)(?:(?:public|private|protected|internal|static|abstract|sealed|partial)\s+)*(?:class|struct|interface|record)\s+(\w+)/;
const CS_METHOD_RE = /^(\s*)((?:public|private|protected|internal|static|async|override|virtual|sealed|readonly|abstract|\s)+)\s*(?:[A-Za-z_<>,\s\[\]\?]+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:where[^{]+)?\s*\{?/;

function scanCSharp(lines: string[]): StructuralMethod[] {
  const results: StructuralMethod[] = [];
  const classStack: Array<{ name: string; openDepth: number }> = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    while (classStack.length > 0 && braceDepth < classStack[classStack.length - 1].openDepth) {
      classStack.pop();
    }

    try {
      const owning = classStack.length > 0 ? classStack[classStack.length - 1].name : null;

      const classMatch = CS_CLASS_DECL_RE.exec(line);
      if (classMatch) {
        classStack.push({ name: classMatch[2], openDepth: braceDepth + 1 });
        braceDepth += countBraceDelta(line);
        continue;
      }

      const m = CS_METHOD_RE.exec(line);
      if (m) {
        const modifiers = m[2];
        const name = m[3];
        if (['if', 'for', 'while', 'switch', 'return', 'else', 'do', 'try', 'catch', 'throw', 'new', 'class', 'struct', 'interface', 'record', 'enum', 'namespace'].includes(name)) {
          braceDepth += countBraceDelta(line);
          continue;
        }
        const visibility = parseVisibility(modifiers);
        const isAsync = /\basync\b/.test(modifiers);
        const params = (m[4] ?? '').trim();
        results.push({
          name,
          params,
          paramCount: countParams(params),
          returnType: '',
          isExported: visibility === 'public' || visibility === 'internal',
          isAsync,
          visibility,
          kind: owning ? 'method' : 'function',
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          owningSymbol: owning,
        });
      }
    } catch {
      // skip
    }

    braceDepth += countBraceDelta(line);
  }

  results.sort((a, b) => a.sourceLine - b.sourceLine);
  return results;
}

// ============================================================================
// C++ — good-effort
// ============================================================================

const CPP_FUNC_RE = /^(\s*)(?:[A-Za-z_][A-Za-z0-9_<>,\s\*&:]*?\s+)([A-Za-z_][A-Za-z0-9_:]*)\s*\(([^)]*)\)\s*(?:const)?\s*(?:noexcept)?\s*\{/;

function scanCpp(lines: string[]): StructuralMethod[] {
  const results: StructuralMethod[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const m = CPP_FUNC_RE.exec(line);
      if (m) {
        let name = m[2];
        let owningSymbol: string | null = null;
        if (name.includes('::')) {
          const parts = name.split('::');
          owningSymbol = parts.slice(0, -1).join('::');
          name = parts[parts.length - 1];
        }
        if (['if', 'for', 'while', 'switch', 'return', 'else'].includes(name)) continue;
        const params = (m[3] ?? '').trim();
        results.push({
          name,
          params,
          paramCount: countParams(params),
          returnType: '',
          isExported: true, // C++ top-level functions are externally visible unless static
          isAsync: false,
          visibility: null,
          kind: owningSymbol ? 'method' : 'function',
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          owningSymbol,
        });
      }
    } catch {
      // skip
    }
  }

  results.sort((a, b) => a.sourceLine - b.sourceLine);
  return results;
}

// ============================================================================
// Python
// ============================================================================

const PY_CLASS_RE = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)/;
const PY_DEF_RE = /^(\s*)(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/;

function scanPython(lines: string[]): StructuralMethod[] {
  const results: StructuralMethod[] = [];
  const classStack: Array<{ name: string; indent: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const leadingIndent = line.match(/^(\s*)/)?.[1].length ?? 0;

    // Pop class stack entries whose indent is >= current line's indent
    while (classStack.length > 0 && leadingIndent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    const owning = classStack.length > 0 ? classStack[classStack.length - 1].name : null;

    try {
      const classMatch = PY_CLASS_RE.exec(line);
      if (classMatch) {
        classStack.push({ name: classMatch[2], indent: classMatch[1].length });
        continue;
      }

      const m = PY_DEF_RE.exec(line);
      if (m) {
        const name = m[3];
        const visibility: 'private' | null = name.startsWith('_') ? 'private' : null;
        const params = (m[4] ?? '').trim();
        results.push({
          name,
          params,
          paramCount: countParams(params),
          returnType: (m[5] ?? '').trim(),
          isExported: !name.startsWith('_'),
          isAsync: !!m[2],
          visibility,
          kind: owning ? 'method' : 'function',
          sourceLine: i + 1,
          sourceLineEnd: null, // Python end detection is hard; skip for now
          owningSymbol: owning,
        });
      }
    } catch {
      // skip
    }
  }

  results.sort((a, b) => a.sourceLine - b.sourceLine);
  return results;
}

// ============================================================================
// Brace walker (copied from ui/src/lib/extract-functions.ts)
// ============================================================================

function countBraceDelta(line: string): number {
  // Simple brace counter — doesn't handle all edge cases but good enough
  // for class-stack depth tracking.
  let depth = 0;
  let inString: string | null = null;
  let inLineComment = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (inLineComment) break;

    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; break; }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }

  return depth;
}

function findMatchingBraceLineIndex(lines: string[], startIndex: number): number | null {
  const stack: Array<'code' | 'string-single' | 'string-double' | 'string-backtick'> = ['code'];
  let inBlockComment = false;
  let depth = 0;
  let seenOpen = false;

  const top = () => stack[stack.length - 1];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      const next = line[j + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j += 2; continue; }
        j++;
        continue;
      }

      const mode = top();

      if (mode === 'string-single' || mode === 'string-double') {
        if (ch === '\\') { j += 2; continue; }
        if ((mode === 'string-single' && ch === "'") || (mode === 'string-double' && ch === '"')) {
          stack.pop();
        }
        j++;
        continue;
      }

      if (mode === 'string-backtick') {
        if (ch === '\\') { j += 2; continue; }
        if (ch === '`') { stack.pop(); j++; continue; }
        if (ch === '$' && next === '{') { stack.push('code'); j += 2; continue; }
        j++;
        continue;
      }

      // mode === 'code'
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') { inBlockComment = true; j += 2; continue; }
      if (ch === "'") { stack.push('string-single'); j++; continue; }
      if (ch === '"') { stack.push('string-double'); j++; continue; }
      if (ch === '`') { stack.push('string-backtick'); j++; continue; }

      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        if (stack.length > 1) {
          stack.pop();
          j++;
          continue;
        }
        depth--;
        if (seenOpen && depth === 0) {
          return i;
        }
      }
      j++;
    }
  }
  return null;
}

function computeEndLine(lines: string[], startIdx: number): number | null {
  const result = findMatchingBraceLineIndex(lines, startIdx);
  return result === null ? null : result + 1;
}

/**
 * Starting from `lines[fromIndex]` at column `fromCol` (after a matched
 * open paren), forward-scan until we find the matching closing paren at
 * depth 0 (respecting strings and line/block comments), then continue past
 * any return-type annotation until the first `{` is seen. Returns the
 * captured params string, the line index of the opening `{`, and the raw
 * return-type text (may be empty).
 *
 * Bounded at 50 lines forward. Returns null if no opening `{` is found in
 * that window — the match is treated as an abstract decl / interface and
 * skipped.
 */
function captureMultiLineSignature(
  lines: string[],
  fromIndex: number,
  fromCol: number,
): { params: string; braceLine: number; returnType: string } | null {
  const MAX_LINES = 50;
  const maxLine = Math.min(lines.length, fromIndex + MAX_LINES);

  // ---- Phase 1: capture params until the matching `)` at paren depth 0. ----
  let parenDepth = 1; // caller has already consumed the opening `(`
  let params = '';
  let closeLine = -1;
  let closeCol = -1;
  let inString: "'" | '"' | '`' | null = null;
  let inBlockComment = false;

  phase1: for (let i = fromIndex; i < maxLine; i++) {
    const line = lines[i];
    const startJ = i === fromIndex ? fromCol : 0;
    for (let j = startJ; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (inString) {
        params += ch;
        if (ch === '\\') { if (j + 1 < line.length) { params += line[j + 1]; j++; } continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && next === '/') {
        // line comment — skip rest of line
        break;
      }
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inString = ch as "'" | '"' | '`'; params += ch; continue; }

      if (ch === '(') { parenDepth++; params += ch; continue; }
      if (ch === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          closeLine = i;
          closeCol = j + 1;
          break phase1;
        }
        params += ch;
        continue;
      }
      params += ch;
    }
    // newline between lines becomes a space in the captured string
    params += ' ';
  }

  if (closeLine === -1) return null;

  // ---- Phase 2: from just after the `)`, forward-scan for the first `{`. ----
  let returnType = '';
  inString = null;
  inBlockComment = false;

  for (let i = closeLine; i < maxLine; i++) {
    const line = lines[i];
    const startJ = i === closeLine ? closeCol : 0;
    for (let j = startJ; j < line.length; j++) {
      const ch = line[j];
      const next = line[j + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (inString) {
        returnType += ch;
        if (ch === '\\') { if (j + 1 < line.length) { returnType += line[j + 1]; j++; } continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inString = ch as "'" | '"' | '`'; returnType += ch; continue; }

      if (ch === '{') {
        return {
          params: params.trim(),
          braceLine: i,
          returnType: trimReturnType(returnType),
        };
      }
      // `;` or `=>` etc. — stop (not a method body)
      if (ch === ';') return null;
      returnType += ch;
    }
    returnType += ' ';
  }

  return null;
}
