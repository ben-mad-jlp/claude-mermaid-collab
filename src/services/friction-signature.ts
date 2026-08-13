import { createHash } from 'node:crypto';

/**
 * Compute a stable signature for a friction note that is invariant across cosmetic
 * detail differences (ids, paths, timestamps, casing, token ordering).
 *
 * The signature makes two notes with identical substantive reasons but different
 * ephemeral detail (uuids, commit shas, paths, timestamps) collapse into the same
 * recurrence signature, while distinctly-different reasons never collide.
 */
export function computeFrictionSignature(retryReason: string, detail?: string | null): string {
  // Reason part: lowercase, trim, collapse internal whitespace.
  const reasonPart = (retryReason || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  // Detail part: strip volatile tokens, then extract salient tokens.
  const salientTokens = extractSalientTokens(detail);

  // Hash the reason + tokens.
  const hashInput = reasonPart + ' ' + salientTokens.join(' ');
  const hash = createHash('sha256').update(hashInput).digest('hex');
  return hash.slice(0, 16);
}

/**
 * Extract salient tokens from detail by:
 * 1. Stripping volatile tokens (uuids, hex runs ≥7 chars, absolute paths, ISO timestamps, digit runs).
 * 2. Tokenizing on non-word chars.
 * 3. Dropping tokens <3 chars.
 * 4. Deduping and sorting ascending.
 * 5. Keeping at most 12 tokens.
 */
function extractSalientTokens(detail?: string | null): string[] {
  if (!detail) return [];

  let text = detail.toLowerCase();

  // Strip volatile tokens.
  // Uuids: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ' ');

  // Bare hex runs ≥7 chars (shas, short-ids).
  text = text.replace(/[0-9a-f]{7,}/g, ' ');

  // Absolute paths: /leading runs.
  text = text.replace(/\/[^\s]*/g, ' ');

  // ISO timestamps (approximate).
  text = text.replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/g, ' ');
  text = text.replace(/\d{4}-\d{2}-\d{2}/g, ' ');

  // Digit runs.
  text = text.replace(/\d+/g, ' ');

  // Tokenize on non-word chars, drop tokens <3 chars, dedupe, sort, truncate.
  const tokens = text
    .split(/\W+/)
    .filter((t) => t.length >= 3)
    .filter((t, i, a) => i === 0 || a[i - 1] !== t) // dedupe consecutive
    .sort()
    .slice(0, 12);

  return [...new Set(tokens)].sort();
}
