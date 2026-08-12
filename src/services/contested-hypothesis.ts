/**
 * contested-hypothesis — falsify a contested reviewer's STATED CAUSE before re-arming the wall.
 *
 * THE INCIDENT (yolox-markup mission 6e7ef04d, 2026-08-07). Leaf 9acbb620 raised a contested
 * card twice; both timed out unanswered after 10 minutes and parked. Between the cycles the
 * implement node acted on the reviewer's stated cause — "the merge dropped the capture_service
 * and ssh_service imports" — and restored them. That was WRONG, and falsifiable in one command:
 *
 *     grep -c 'capture_service\.' <file>   -> 0
 *     grep -c 'ssh_service\.'     <file>   -> 0
 *
 * ZERO call sites. The imports had been removed deliberately by a refactor that removed all
 * their uses, so restoring them was a no-op and the wall was guaranteed to repeat. Two full
 * implement→review cycles produced no diagnosis. The real cause was elsewhere entirely
 * (a `.name` read on a value tests legitimately supply as a bare string); a human found it in
 * four commands.
 *
 * THE RULE THIS ENCODES: a card that times out must not leave an UNVERIFIED hypothesis standing
 * as the leaf's working theory. Either falsify it, or mark it UNTESTED so the next cycle knows
 * not to trust it. Cycle 2 starting from cycle 1's unexamined guess is how a wall repeats.
 *
 * Scope is deliberately narrow: the "dropped/missing symbol" claim is the common shape and has
 * a one-command falsifier. Everything else returns `untested` — which is itself the useful
 * output, because it tells the next cycle the hypothesis is unproven rather than silently
 * letting it read as established.
 */

/** One reviewer claim of the form "X was dropped/removed/missing". */
export interface SymbolClaim {
  /** The symbol the reviewer says went missing. */
  symbol: string;
  /** The claim sentence, trimmed — kept so a human can see what was actually asserted. */
  quote: string;
}

export type ClaimStatus =
  /** Zero call sites — the symbol is genuinely unused, so "it was dropped" explains nothing. */
  | 'falsified'
  /** Call sites exist, so the claim is at least coherent. NOT proof it is the cause. */
  | 'supported'
  /** No cheap falsifier applies, or the probe failed. The hypothesis is UNPROVEN. */
  | 'untested';

export interface ClaimVerdict {
  symbol: string;
  status: ClaimStatus;
  /** Call-site count when the probe ran; null when it did not. */
  callSites: number | null;
  quote: string;
}

/** Connectives, agents, and generic nouns that surround a drop claim but are never the symbol.
 *  A false extraction produces a confidently wrong "falsified" verdict, so this errs wide. */
const STOPWORDS = new Set([
  'the', 'and', 'its', 'was', 'were', 'are', 'import', 'imports', 'from', 'this', 'that',
  'call', 'calls', 'usage', 'usages', 'reference', 'references', 'merge', 'file', 'files',
  'line', 'lines', 'code', 'they', 'them', 'have', 'has', 'refactor', 'commit', 'change',
  'changes', 'branch', 'patch', 'diff', 'when', 'which', 'because', 'since', 'block',
]);

/** Verbs a reviewer uses when asserting something went missing. Matched case-insensitively. */
const DROP_VERBS = '(?:dropped|removed|deleted|missing|lost|stripped|omitted)';

/**
 * Extract dropped/missing-symbol claims from review prose. Deliberately conservative: it only
 * fires on an explicit drop-verb near an identifier, because a false claim-extraction produces
 * a confidently wrong "falsified" verdict, which is worse than no verdict at all.
 *
 * Handles both orders — "the merge dropped the capture_service import" and "capture_service was
 * removed" — and the multi-symbol form "dropped the capture_service and ssh_service imports".
 */
export function extractSymbolClaims(reviewText: string | null | undefined): SymbolClaim[] {
  const text = (reviewText ?? '').trim();
  if (!text) return [];
  const out: SymbolClaim[] = [];
  const seen = new Set<string>();

  const push = (symbol: string, quote: string): void => {
    // Identifier-ish only, and long enough not to be a stopword like "it" or "the".
    if (!/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(symbol)) return;
    // Centralised so BOTH scan directions filter identically — the reverse scan used to skip
    // this and captured "merge" out of "The merge dropped ...".
    if (STOPWORDS.has(symbol.toLowerCase())) return;
    if (new RegExp(`^${DROP_VERBS}$`).test(symbol.toLowerCase())) return;
    if (seen.has(symbol)) return;
    seen.add(symbol);
    out.push({ symbol, quote: quote.trim().slice(0, 300) });
  };

  for (const rawLine of text.split(/[\n.;]/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (!new RegExp(DROP_VERBS).test(lower)) continue;

    const verbAt = lower.search(new RegExp(DROP_VERBS));

    // REVERSED ORDER: "<symbol> was removed" / "<symbol> is missing" — the identifier sits
    // BEFORE the verb, so an after-the-verb scan alone misses it entirely.
    const before = line.slice(0, verbAt);
    const rev = before.match(/[`'"]?\b([A-Za-z_][A-Za-z0-9_]{2,})\b[`'"]?\s*(?:was|were|is|are|got|had|has been|have been)?\s*$/);
    if (rev) push(rev[1]!, line);

    // FORWARD ORDER: "<verb> ... the `a` and `b` imports" → identifiers AFTER the verb.
    // Truncate at an agent marker: in "removed BY the refactor", what follows is WHO did it,
    // not WHAT went missing.
    let after = line.slice(verbAt);
    const byAt = after.toLowerCase().search(/\bby\b/);
    if (byAt > 0) after = after.slice(0, byAt);
    for (const m of after.matchAll(/[`'"]?\b([A-Za-z_][A-Za-z0-9_]{2,})\b[`'"]?/g)) {
      push(m[1]!, line);
    }
  }
  return out;
}

/**
 * Run each claim through the call-site falsifier.
 *
 * `countCallSites` is injected so the decision logic stays pure and testable — the executor
 * supplies a real `git grep` implementation. A probe that throws yields 'untested', never a
 * false 'falsified': a broken probe must not be mistaken for evidence of absence.
 */
export async function falsifySymbolClaims(
  claims: SymbolClaim[],
  countCallSites: (symbol: string) => Promise<number>,
): Promise<ClaimVerdict[]> {
  const verdicts: ClaimVerdict[] = [];
  for (const c of claims) {
    try {
      const n = await countCallSites(c.symbol);
      verdicts.push({
        symbol: c.symbol,
        status: n === 0 ? 'falsified' : 'supported',
        callSites: n,
        quote: c.quote,
      });
    } catch {
      verdicts.push({ symbol: c.symbol, status: 'untested', callSites: null, quote: c.quote });
    }
  }
  return verdicts;
}

/**
 * Human- and next-cycle-readable summary. The FALSIFIED lines are the point: they tell the next
 * implement cycle not to spend itself restoring something nothing calls.
 *
 * Returns null when there is nothing useful to say, so a caller can skip recording entirely
 * rather than emit an empty note.
 */
export function summarizeHypothesisCheck(verdicts: ClaimVerdict[]): string | null {
  if (verdicts.length === 0) return null;
  const falsified = verdicts.filter((v) => v.status === 'falsified');
  const supported = verdicts.filter((v) => v.status === 'supported');
  const untested = verdicts.filter((v) => v.status === 'untested');

  const lines: string[] = ['HYPOTHESIS CHECK on the contested reviewer\'s stated cause:'];
  for (const v of falsified) {
    lines.push(`  FALSIFIED — "${v.symbol}" has ZERO call sites. "It was dropped" explains nothing; restoring it is a no-op and this wall will repeat. Do NOT act on this cause.`);
  }
  for (const v of supported) {
    lines.push(`  SUPPORTED — "${v.symbol}" has ${v.callSites} call site(s). The claim is coherent, which is NOT proof it is the cause.`);
  }
  for (const v of untested) {
    lines.push(`  UNTESTED — "${v.symbol}" could not be probed. Treat as UNPROVEN, not as established.`);
  }
  if (falsified.length > 0) {
    lines.push('  → Cycle 2 must start from a DIFFERENT hypothesis than cycle 1.');
  }
  return lines.join('\n');
}

/** True when at least one stated cause was positively falsified — the signal worth acting on. */
export function hasFalsifiedClaim(verdicts: ClaimVerdict[]): boolean {
  return verdicts.some((v) => v.status === 'falsified');
}

/**
 * The whole timed-out-card check in one call, so `leaf-executor` stays a thin caller.
 * (leaf-executor.ts is under a LOC ratchet — logic belongs in modules like this one, not
 * inlined into the executor, which is exactly what the ratchet is there to force.)
 *
 * Returns null when there is nothing to say: no parseable claim, or no probe available.
 * Never throws — the falsifier is advisory and must never break a leaf run.
 */
export async function checkContestedHypothesis(
  reviewText: string | null | undefined,
  countCallSites: ((symbol: string) => Promise<number>) | undefined,
  record?: (r: { verdict: 'pass' | 'fail'; detail: string; text: string }) => void,
): Promise<string | null> {
  try {
    if (!countCallSites) return null;
    const claims = extractSymbolClaims(reviewText);
    if (claims.length === 0) return null;
    const verdicts = await falsifySymbolClaims(claims, countCallSites);
    const note = summarizeHypothesisCheck(verdicts);
    if (!note) return null;
    try {
      record?.({
        verdict: hasFalsifiedClaim(verdicts) ? 'fail' : 'pass',
        detail: JSON.stringify({ reason: 'contested-cause-falsifier', verdicts }),
        text: note,
      });
    } catch { /* telemetry — never break the run */ }
    return note;
  } catch {
    return null;
  }
}
