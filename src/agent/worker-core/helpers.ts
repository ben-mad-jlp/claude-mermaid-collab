/**
 * Pure host helpers for the worker-core state machine.
 *
 * The fix loop is HOST-owned and self-terminating: if a verify/gate failure repeats
 * UNCHANGED, the worker is stuck → escalate (never grind). "Unchanged" must be robust
 * to cosmetic churn (absolute paths, line:col numbers, addresses, whitespace) or it
 * would loop forever on equivalent-but-not-identical error text.
 */

/** Normalize one error line so cosmetic differences don't make the SAME failure look
 *  different: absolute path → basename, `:line:col` / `:line` → placeholders, hex
 *  addresses → placeholder, whitespace collapsed, lowercased. */
export function normalizeErrorSig(raw: string): string {
  return raw
    .replace(/(?:\/[^\s:]+)+\/([^\s/:]+)/g, '$1') // /abs/path/foo.ts → foo.ts
    .replace(/:\d+:\d+/g, ':L:C') // :line:col
    .replace(/:\d+\b/g, ':L') // :line
    .replace(/0x[0-9a-f]+/gi, '0xADDR') // hex addresses
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when two error-signature sets represent the SAME failure — normalized,
 *  de-duplicated, order-independent equality. The fix loop's stuck detector:
 *  same signatures twice in a row ⇒ escalate. */
export function sameSignatures(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) => [...new Set(xs.map(normalizeErrorSig).filter(Boolean))].sort();
  const na = norm(a);
  const nb = norm(b);
  if (na.length !== nb.length) return false;
  return na.every((x, i) => x === nb[i]);
}
