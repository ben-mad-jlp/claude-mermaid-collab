/**
 * applyEdit — exact-match string replacement with a fuzzy "replacer cascade".
 *
 * VENDORED from opencode (github.com/sst/opencode) tag `v0.3.0`,
 * `packages/opencode/src/tool/edit.ts` — MIT License, Copyright (c) 2025 opencode.
 * Lifted as a standalone pure function (stripped of opencode's LSP / permission /
 * tool coupling). Logic preserved; restyled to this repo's lint (single quotes,
 * semicolons). Provenance + license: see `src/agent/worker-core/tools/VENDOR.md`.
 *
 * Why harvest this: the value is the EDGE-CASE cascade, not the happy path. We try
 * increasingly-fuzzy matchers (exact → line-trimmed → block-anchor → whitespace-
 * normalized → indentation-flexible); the first candidate that occurs EXACTLY ONCE
 * is replaced. The single-occurrence uniqueness guard (`index === lastIndex`)
 * applies UNIFORMLY across every replacer — an ambiguous match (>1 site) is skipped,
 * never silently corrupting the file. (In v0.3.0 this guard is already uniform; the
 * "only SimpleReplacer is guarded" corruption bug is a LATER-version regression we
 * deliberately did not inherit.) Throws when no unique match exists.
 */

/** A replacer yields candidate substrings of `content` that `find` may correspond
 *  to under that replacer's fuzziness. The caller verifies each candidate occurs
 *  exactly once before replacing. */
type Replacer = (content: string, find: string) => Generator<string>;

/** Exact match — the candidate IS the find string. */
export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

/** Match line-by-line ignoring leading/trailing whitespace per line. */
export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim();
      const searchTrimmed = searchLines[j].trim();
      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1;
      }
      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length + 1;
      }
      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

/** Anchor on the first and last lines of a ≥3-line block, ignoring the middle —
 *  robust to edits whose interior drifted but whose boundaries are stable. */
export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines.length < 3) {
    return;
  }
  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }
  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue;
    }
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        let matchStartIndex = 0;
        for (let k = 0; k < i; k++) {
          matchStartIndex += originalLines[k].length + 1;
        }
        let matchEndIndex = matchStartIndex;
        for (let k = 0; k <= j - i; k++) {
          matchEndIndex += originalLines[i + k].length;
          if (k < j - i) {
            matchEndIndex += 1;
          }
        }
        yield content.substring(matchStartIndex, matchEndIndex);
        break;
      }
    }
  }
};

/** Collapse all runs of whitespace to a single space before comparing. */
export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalizeWhitespace(find);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    }
    const normalizedLine = normalizeWhitespace(line);
    if (normalizedLine.includes(normalizedFind)) {
      const words = find.trim().split(/\s+/);
      if (words.length > 0) {
        const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        try {
          const regex = new RegExp(pattern);
          const match = line.match(regex);
          if (match) {
            yield match[0];
          }
        } catch {
          // Invalid regex pattern, skip.
        }
      }
    }
  }
  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
        yield block.join('\n');
      }
    }
  }
};

/** Strip the common minimum indentation from both sides before comparing — robust
 *  to a block being re-indented as a whole. */
export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return text;
    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
      }),
    );
    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n');
  };
  const normalizedFind = removeIndentation(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (removeIndentation(block) === normalizedFind) {
      yield block;
    }
  }
};

/** The cascade, tried in order of increasing fuzziness. */
const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
];

/**
 * Replace `oldString` with `newString` in `content`.
 *
 * - `replaceAll=false` (default): the matched candidate MUST occur exactly once,
 *   else the cascade moves on / ultimately throws — never an ambiguous edit.
 * - `replaceAll=true`: every occurrence of the first matching candidate is replaced.
 *
 * @throws if oldString === newString, or no unique match is found.
 */
export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error('applyEdit: oldString and newString must be different');
  }
  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      if (replaceAll) {
        return content.replaceAll(search, newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue; // ambiguous → skip, never corrupt
      return content.substring(0, index) + newString + content.substring(index + search.length);
    }
  }
  throw new Error('applyEdit: oldString not found in content, or found multiple times (ambiguous)');
}
