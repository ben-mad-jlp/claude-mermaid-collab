import { damerauLevenshtein } from './distance';

type Vocab = { protected: Set<string>; targets: Set<string> };

export function correctToken(
  token: string,
  vocab: Vocab,
): { from: string; to: string; strength: 'strong' } | null {
  // Filter 1: too short
  if (token.length < 5) return null;

  // Filter 2: starts with - or /
  if (token.startsWith('-') || token.startsWith('/')) return null;

  // Filter 3: disallowed chars (/ \ . _ - ~ @ # $ : = or digits)
  if (/[\/\\\._\-~@#$:=]|\d/.test(token)) return null;

  // Filter 4: camelCase
  if (/[a-z][A-Z]/.test(token)) return null;

  // Filter 5: ALLCAPS
  if (token === token.toUpperCase() && /[A-Z]/.test(token)) return null;

  const lower = token.toLowerCase();

  // Filter 6: protected exact match
  if (vocab.protected.has(lower)) return null;

  // Find dist-1 candidates
  const candidates = [];
  for (const target of vocab.targets) {
    if (damerauLevenshtein(lower, target, 1) === 1) {
      candidates.push(target);
    }
  }

  // Return only if exactly one candidate
  if (candidates.length === 1) {
    return {
      from: token,
      to: candidates[0],
      strength: 'strong',
    };
  }

  return null;
}

export function correctMessage(
  text: string,
  vocab: Vocab,
): { start: number; end: number; from: string; to: string }[] {
  const corrections: { start: number; end: number; from: string; to: string }[] = [];

  // Build protected character ranges from quotes
  const protectedIndices = new Set<number>();
  let openQuote: string | null = null;
  let openIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '`' || char === "'" || char === '"') {
      if (openQuote === null) {
        // Open a new region
        openQuote = char;
        openIndex = i;
      } else if (char === openQuote) {
        // Close the region
        for (let j = openIndex; j <= i; j++) {
          protectedIndices.add(j);
        }
        openQuote = null;
        openIndex = -1;
      }
    }
  }

  // If a quote region is still open, extend to end of text
  if (openQuote !== null) {
    for (let j = openIndex; j < text.length; j++) {
      protectedIndices.add(j);
    }
  }

  // Find all whitespace-delimited tokens
  const tokenRegex = /\S+/g;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    const tokenText = match[0];
    const start = match.index;
    const end = start + tokenText.length;

    // Skip if token overlaps a protected region
    let isProtected = false;
    for (let i = start; i < end; i++) {
      if (protectedIndices.has(i)) {
        isProtected = true;
        break;
      }
    }

    if (isProtected) continue;

    // Try to correct
    const correction = correctToken(tokenText, vocab);
    if (correction) {
      corrections.push({
        start,
        end,
        from: correction.from,
        to: correction.to,
      });
    }
  }

  return corrections;
}
