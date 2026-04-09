/**
 * Extract function metadata from TS/JS source code.
 *
 * Two capabilities:
 *
 * 1. `extractFunctions(code, language)` — regex-based parser that returns a
 *    list of function-like definitions with their line numbers. Used as the
 *    Tier 2 fallback for the Function Jump Dropdown when the pseudo-db has
 *    no index for the current file.
 *
 * 2. `findSymbolAtPos(view, pos)` — Lezer-backed helper for click-on-symbol
 *    detection. Used by the CodeMirrorWrapper's onSymbolClick extension.
 *
 * Both return null/empty gracefully on unsupported languages, parse failures,
 * or non-identifier positions — never throws.
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

export interface ExtractedFunction {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  sourceLine: number;        // 1-based
  sourceLineEnd: number | null;
  visibility: null;          // Tier 2 doesn't infer visibility
  isAsync: boolean;
  kind: 'function' | 'method' | 'callback' | null;
}

const TS_JS_LANGUAGES = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js']);

// Top-level function declarations: `export? async? function name(params): returnType? {?`
const FUNCTION_DECL_RE = /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?\s*\{?/;

// Arrow function assigned to var: `export? const/let/var name: type? = async? (params): returnType? =>`
const ARROW_RE = /^\s*(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^={]+))?\s*=>/;

// Function expression assigned to var: `export? const/let/var name = async? function(params): returnType? {?`
const FUNC_EXPR_RE = /^\s*(export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?function\s*\*?\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?\s*\{?/;

function trimReturnType(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/[=>{;]\s*$/, '').trim();
}

/**
 * Walk forward from `startIndex` tracking `{`/`}` depth. Returns the 0-based
 * line index of the closing brace, or null if no block is found.
 *
 * Tracks string and comment state to avoid counting braces in literals.
 */
function findMatchingBraceLineIndex(lines: string[], startIndex: number): number | null {
  // Mode stack: 'code' | 'string-single' | 'string-double' | 'string-backtick'
  // Block comment: separate flag
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
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          j += 2;
          continue;
        }
        j++;
        continue;
      }

      const mode = top();

      if (mode === 'string-single' || mode === 'string-double') {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if ((mode === 'string-single' && ch === "'") || (mode === 'string-double' && ch === '"')) {
          stack.pop();
        }
        j++;
        continue;
      }

      if (mode === 'string-backtick') {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '`') {
          stack.pop();
          j++;
          continue;
        }
        if (ch === '$' && next === '{') {
          // Enter interpolation — push a code context
          stack.push('code');
          j += 2;
          continue;
        }
        j++;
        continue;
      }

      // mode === 'code'
      if (ch === '/' && next === '/') break; // line comment
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        j += 2;
        continue;
      }
      if (ch === "'") {
        stack.push('string-single');
        j++;
        continue;
      }
      if (ch === '"') {
        stack.push('string-double');
        j++;
        continue;
      }
      if (ch === '`') {
        stack.push('string-backtick');
        j++;
        continue;
      }

      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        // If we're inside a nested template-interpolation code context, pop back instead of counting
        if (stack.length > 1) {
          stack.pop(); // exit interpolation back to backtick string
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
  return result === null ? null : result + 1; // 1-based
}

/**
 * Extract function definitions from TS/JS source. Returns [] for unsupported
 * languages or empty input. Malformed lines are silently skipped.
 */
export function extractFunctions(code: string, language: string): ExtractedFunction[] {
  if (!code || typeof code !== 'string') return [];
  if (!language || !TS_JS_LANGUAGES.has(language.toLowerCase())) return [];

  const lines = code.split('\n');
  const results: ExtractedFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      let m = FUNCTION_DECL_RE.exec(line);
      if (m) {
        results.push({
          name: m[3],
          params: (m[4] ?? '').trim(),
          returnType: trimReturnType(m[5]),
          isExported: !!m[1],
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          visibility: null,
          isAsync: !!m[2],
          kind: 'function',
        });
        continue;
      }

      m = ARROW_RE.exec(line);
      if (m) {
        results.push({
          name: m[2],
          params: (m[4] ?? '').trim(),
          returnType: trimReturnType(m[5]),
          isExported: !!m[1],
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          visibility: null,
          isAsync: !!m[3],
          kind: 'callback',
        });
        continue;
      }

      m = FUNC_EXPR_RE.exec(line);
      if (m) {
        results.push({
          name: m[2],
          params: (m[4] ?? '').trim(),
          returnType: trimReturnType(m[5]),
          isExported: !!m[1],
          sourceLine: i + 1,
          sourceLineEnd: computeEndLine(lines, i),
          visibility: null,
          isAsync: !!m[3],
          kind: 'function',
        });
      }
    } catch {
      // Silently skip malformed lines
      continue;
    }
  }

  // Already in line order; explicit sort for safety.
  results.sort((a, b) => a.sourceLine - b.sourceLine);
  return results;
}

function isIdentifierType(type: string): boolean {
  return (
    type === 'VariableName' ||
    type === 'PropertyName' ||
    type === 'VariableDefinition' ||
    type === 'PropertyDefinition'
  );
}

/**
 * Find the identifier at a given document position in a CodeMirror editor.
 * Returns null if the position doesn't resolve to an identifier token.
 *
 * Walks up to 3 ancestor levels looking for an identifier-like node type,
 * so clicks on adjacent whitespace or punctuation can still resolve.
 */
export function findSymbolAtPos(view: EditorView, pos: number): string | null {
  try {
    const tree = syntaxTree(view.state);
    let node: { type: { name: string }; from: number; to: number; parent: any } | null =
      tree.resolveInner(pos, 0) as any;

    for (let i = 0; i < 3; i++) {
      if (!node) break;
      if (isIdentifierType(node.type.name)) {
        return view.state.doc.sliceString(node.from, node.to);
      }
      node = node.parent;
    }
    return null;
  } catch {
    return null;
  }
}
