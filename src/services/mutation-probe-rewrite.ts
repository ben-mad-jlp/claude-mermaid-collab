export interface RewriteResult {
  applied: boolean;
  source: string;
  reason?: string;
}

/**
 * Locate the body span of a symbol declaration in source code.
 * Supports three patterns in order of priority:
 * 1. export function/async function
 * 2. export const with arrow function (braced or expression)
 * 3. Method shorthand (best effort)
 *
 * Returns {startIdx, endIdx, isExpression} or null if not found.
 * For expression-bodied arrows, isExpression=true and the span is the entire expression.
 */
function locateSymbolBody(
  source: string,
  symbol: string
): { startIdx: number; endIdx: number; isExpression: boolean } | null {
  // Pattern 1: export (async) function <symbol>(
  const escapedSymbol = escapeRegExp(symbol);
  const funcPattern = new RegExp(
    `\\bexport\\s+(async\\s+)?function\\s+${escapedSymbol}\\s*\\(`,
    "m"
  );
  const funcMatch = funcPattern.exec(source);
  if (funcMatch) {
    const matchEnd = funcMatch.index + funcMatch[0].length;
    const bodyStart = findFirstOpenBrace(source, matchEnd);
    if (bodyStart !== -1) {
      const bodyEnd = findMatchingCloseBrace(source, bodyStart);
      if (bodyEnd !== -1) {
        return { startIdx: bodyStart, endIdx: bodyEnd + 1, isExpression: false };
      }
    }
  }

  // Pattern 2: export const <symbol> = (async )? ( ... ) => { ... } or => <expr>
  const arrowPattern = new RegExp(
    `\\bexport\\s+const\\s+${escapeRegExp(symbol)}\\s*=\\s*(async\\s+)?`,
    "m"
  );
  const arrowMatch = arrowPattern.exec(source);
  if (arrowMatch) {
    const afterAsync = arrowMatch.index + arrowMatch[0].length;
    // Skip optional parentheses and find =>
    const arrowIdx = findArrowOperator(source, afterAsync);
    if (arrowIdx !== -1) {
      // Check if next non-whitespace is {
      let idx = arrowIdx + 2; // skip '=>'
      while (idx < source.length && /\s/.test(source[idx])) idx++;

      if (idx < source.length && source[idx] === "{") {
        // Braced arrow body
        const bodyEnd = findMatchingCloseBrace(source, idx);
        if (bodyEnd !== -1) {
          return { startIdx: idx, endIdx: bodyEnd + 1, isExpression: false };
        }
      } else {
        // Expression-bodied arrow: find the end (semicolon or end of line)
        const exprEnd = findExpressionEnd(source, idx);
        return {
          startIdx: arrowIdx,
          endIdx: exprEnd,
          isExpression: true,
        };
      }
    }
  }

  // Pattern 3: Method shorthand <symbol>( ... ) { ... } (best effort, not preceded by export/const/function)
  const methodPattern = new RegExp(
    `(?<!export|const|function)\\b${escapeRegExp(symbol)}\\s*\\(`,
    "m"
  );
  const methodMatch = methodPattern.exec(source);
  if (methodMatch) {
    const matchEnd = methodMatch.index + methodMatch[0].length;
    const closeParenIdx = findCloseParen(source, matchEnd - 1);
    if (closeParenIdx !== -1) {
      // Find opening brace after )
      let idx = closeParenIdx + 1;
      while (idx < source.length && /\s/.test(source[idx])) idx++;
      if (idx < source.length && source[idx] === "{") {
        const bodyEnd = findMatchingCloseBrace(source, idx);
        if (bodyEnd !== -1) {
          return { startIdx: idx, endIdx: bodyEnd + 1, isExpression: false };
        }
      }
    }
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFirstOpenBrace(source: string, startIdx: number): number {
  for (let i = startIdx; i < source.length; i++) {
    const char = source[i];
    // Skip strings and comments
    if (char === '"' || char === "'" || char === "`") {
      const endIdx = skipStringLiteral(source, i);
      if (endIdx === -1) return -1;
      i = endIdx; // Position at closing quote; loop will increment
    } else if (char === "/" && i + 1 < source.length) {
      if (source[i + 1] === "/") {
        i = skipLineComment(source, i);
        i--; // Compensate for loop increment
      } else if (source[i + 1] === "*") {
        const endIdx = skipBlockComment(source, i);
        if (endIdx === -1) return -1;
        i = endIdx;
        i--; // Compensate for loop increment
      }
    } else if (char === "{") {
      return i;
    }
  }
  return -1;
}

function findMatchingCloseBrace(source: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Handle strings
    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
      if (i === -1) return -1;
      i++; // Move past the closing quote
      continue;
    }

    // Handle comments
    if (char === "/" && i + 1 < source.length) {
      if (source[i + 1] === "/") {
        i = skipLineComment(source, i);
        i++; // Move past the newline
        continue;
      } else if (source[i + 1] === "*") {
        i = skipBlockComment(source, i);
        if (i === -1) return -1;
        i++; // Move past the */
        continue;
      }
    }

    // Track braces
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }

    i++;
  }

  return -1;
}

function skipStringLiteral(source: string, startIdx: number): number {
  const quote = source[startIdx];
  let i = startIdx + 1;

  while (i < source.length) {
    const char = source[i];
    if (char === quote) {
      return i;
    }
    if (char === "\\" && i + 1 < source.length) {
      i += 2; // Skip escaped char
    } else {
      i++;
    }
  }

  return -1; // Unterminated string
}

function skipLineComment(source: string, startIdx: number): number {
  let i = startIdx + 2; // Skip //
  while (i < source.length && source[i] !== "\n") {
    i++;
  }
  return i;
}

function skipBlockComment(source: string, startIdx: number): number {
  let i = startIdx + 2; // Skip /*
  while (i < source.length - 1) {
    if (source[i] === "*" && source[i + 1] === "/") {
      return i + 1;
    }
    i++;
  }
  return -1; // Unterminated comment
}

function findCloseParen(source: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Handle strings
    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
      if (i === -1) return -1;
      continue;
    }

    // Handle comments
    if (char === "/" && i + 1 < source.length) {
      if (source[i + 1] === "/") {
        i = skipLineComment(source, i);
        continue;
      } else if (source[i + 1] === "*") {
        i = skipBlockComment(source, i);
        if (i === -1) return -1;
        continue;
      }
    }

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }

    i++;
  }

  return -1;
}

function findArrowOperator(source: string, startIdx: number): number {
  let parenDepth = 0;
  let i = startIdx;

  // Skip optional parentheses or identifier
  if (source[i] === "(") {
    parenDepth = 1;
    i++;
    while (i < source.length && parenDepth > 0) {
      const char = source[i];
      if (char === '"' || char === "'" || char === "`") {
        i = skipStringLiteral(source, i);
        if (i === -1) return -1;
        continue;
      }
      if (char === "(") parenDepth++;
      else if (char === ")") parenDepth--;
      i++;
    }
  } else {
    // Just skip identifier chars
    while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
  }

  // Now find =>
  while (i < source.length - 1) {
    const char = source[i];

    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
      if (i === -1) return -1;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i);
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      if (i === -1) return -1;
      continue;
    }

    if (char === "=" && source[i + 1] === ">") {
      return i;
    }

    i++;
  }

  return -1;
}

function findExpressionEnd(source: string, startIdx: number): number {
  let i = startIdx;
  let depth = 0;

  while (i < source.length) {
    const char = source[i];

    if (char === '"' || char === "'" || char === "`") {
      i = skipStringLiteral(source, i);
      if (i === -1) return source.length;
      continue;
    }

    if (char === "/" && i + 1 < source.length) {
      if (source[i + 1] === "/") {
        i = skipLineComment(source, i);
        continue;
      } else if (source[i + 1] === "*") {
        i = skipBlockComment(source, i);
        if (i === -1) return source.length;
        continue;
      }
    }

    if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      depth--;
      if (depth < 0) {
        return i;
      }
    } else if (depth === 0 && (char === ";" || char === "," || char === "\n")) {
      return i;
    }

    i++;
  }

  return source.length;
}

export function neuterSymbol(
  source: string,
  symbol: string
): RewriteResult {
  const loc = locateSymbolBody(source, symbol);
  if (!loc) {
    return {
      applied: false,
      source,
      reason: `symbol "${symbol}" not found in ${source.length}-char source`,
    };
  }

  const { startIdx, endIdx, isExpression } = loc;

  if (isExpression) {
    // For expression-bodied arrows, replace => <expr> with => undefined as any
    const before = source.substring(0, startIdx);
    const replacement = "=> undefined as any";
    const after = source.substring(endIdx);
    return { applied: true, source: before + replacement + after };
  } else {
    // For braced bodies, replace { ... } with { return undefined as any; }
    // endIdx points after the closing }, so we need to include it
    const before = source.substring(0, startIdx + 1); // Include opening brace
    const replacement = "return undefined as any;";
    const after = "}" + source.substring(endIdx); // Add closing brace + rest
    return { applied: true, source: before + replacement + after };
  }
}

export function throwProbeSymbol(
  source: string,
  symbol: string
): RewriteResult {
  const loc = locateSymbolBody(source, symbol);
  if (!loc) {
    return {
      applied: false,
      source,
      reason: `symbol "${symbol}" not found in ${source.length}-char source`,
    };
  }

  // Check if appendFileSync is already imported
  const appendFileSync = findAppendFileSync(source);
  const useAlias = appendFileSync || "__mutationProbeAppendFileSync";

  let newSource = source;

  // Add import if needed
  if (!appendFileSync) {
    const importLine = `import { appendFileSync as ${useAlias} } from 'node:fs';\n`;
    newSource = importLine + source;

    // Adjust location indices after inserting import
    const offset = importLine.length;
    loc.startIdx += offset;
    loc.endIdx += offset;
  }

  const { startIdx, endIdx, isExpression } = loc;

  const markerCall = `try { ${useAlias}(process.env.MUTATION_PROBE_MARKER, 'x'); } catch {}`;
  const throwStmt = `throw new Error('MUTATION_PROBE:' + ${JSON.stringify(symbol)});`;

  if (isExpression) {
    // For expression-bodied arrows, wrap in { ... }
    const before = newSource.substring(0, startIdx);
    const replacement = `=> { ${markerCall}\n${throwStmt} }`;
    const after = newSource.substring(endIdx);
    return { applied: true, source: before + replacement + after };
  } else {
    // For braced bodies, insert marker and throw at the start
    // endIdx points after the closing }, so we need to include it
    const before = newSource.substring(0, startIdx + 1); // Include opening brace
    const replacement = `${markerCall}\n${throwStmt}`;
    const after = "}" + newSource.substring(endIdx); // Add closing brace + rest
    return { applied: true, source: before + replacement + after };
  }
}

function findAppendFileSync(source: string): string | null {
  // Look for import { ..., appendFileSync, ... } from 'node:fs'
  // or import { appendFileSync as <alias> } from 'node:fs'
  const importPattern =
    /import\s*\{\s*([^}]*appendFileSync[^}]*)\s*\}\s*from\s*['"]node:fs['"]/;
  const match = importPattern.exec(source);

  if (match) {
    const importList = match[1];
    // Extract the identifier: either 'appendFileSync' or 'appendFileSync as <alias>'
    const asPattern = /appendFileSync\s+as\s+(\w+)/;
    const asMatch = asPattern.exec(importList);
    if (asMatch) {
      return asMatch[1];
    }
    // Check if it's just 'appendFileSync' (no alias)
    if (/\bappendFileSync\b/.test(importList)) {
      return "appendFileSync";
    }
  }

  return null;
}
