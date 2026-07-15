import { damerauLevenshtein } from './distance';
import { COMMON_TYPOS } from './wordlist';

type Vocab = { protected: Set<string>; targets: Set<string> };

type CorrectOpts = { l2?: Set<string> };

export function correctToken(
  token: string,
  vocab: Vocab,
  opts?: CorrectOpts,
): { from: string; to: string; strength: 'strong' } | null {
  // (a) Curated common-typo map — EXACT key match on the lowercased token.
  //     EXEMPT from the length-5 floor and from the digit/symbol filters
  //     (the map is hand-curated, so a hit is always trusted).
  const lowerKey = token.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(COMMON_TYPOS, lowerKey)) {
    return { from: token, to: COMMON_TYPOS[lowerKey], strength: 'strong' };
  }

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

  // (c) L1 already handled above (unique dist-1 target → strong).

  // Return only if exactly one candidate
  if (candidates.length === 1) {
    return {
      from: token,
      to: candidates[0],
      strength: 'strong',
    };
  }

  // (d) NEW L2 fuzzy path: token passed all filters and had NO L1 hit.
  //     If a wide L2 wordlist was supplied, look for a UNIQUE dist-1 candidate there.
  if (opts?.l2) {
    const l2candidates: string[] = [];
    for (const word of opts.l2) {
      if (damerauLevenshtein(lower, word, 1) === 1) {
        l2candidates.push(word);
        if (l2candidates.length > 1) break; // ambiguous → bail
      }
    }
    if (l2candidates.length === 1) {
      return { from: token, to: l2candidates[0], strength: 'strong' };
    }
  }

  return null;
}

/**
 * Peel leading/trailing punctuation (any non letter/number, Unicode-aware) off a
 * whitespace-delimited token so a curated typo like `seperate,` or `wierd.` still
 * matches on its core word. INTERNAL punctuation is left intact, so path/identifier
 * filters in correctToken still fire on the core (e.g. `src/foo.ts.` → core
 * `src/foo.ts`, still rejected). Returns the core plus how many chars were peeled
 * from each side, so callers can offset a replacement to cover only the core and
 * preserve the surrounding punctuation.
 */
export function peelAffixes(token: string): { core: string; lead: number; trail: number } {
  const lead = token.length - token.replace(/^[^\p{L}\p{N}]+/u, '').length;
  const afterLead = token.slice(lead);
  const trail = afterLead.length - afterLead.replace(/[^\p{L}\p{N}]+$/u, '').length;
  const core = afterLead.slice(0, afterLead.length - trail);
  return { core, lead, trail };
}

export function correctMessage(
  text: string,
  vocab: Vocab,
  opts?: CorrectOpts,
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

    // Peel leading/trailing punctuation so `seperate,` / `wierd.` match on their
    // core, and offset the replacement to cover only the core (preserving punct).
    const { core, lead, trail } = peelAffixes(tokenText);
    if (!core) continue;
    const coreStart = start + lead;
    const coreEnd = end - trail;

    // Try to correct
    const correction = correctToken(core, vocab, opts);
    if (correction) {
      corrections.push({
        start: coreStart,
        end: coreEnd,
        from: correction.from,
        to: correction.to,
      });
    }
  }

  return corrections;
}
