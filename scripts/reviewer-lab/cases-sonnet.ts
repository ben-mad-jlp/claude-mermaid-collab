/**
 * SONNET over-rejection hunt — ALL cases are CORRECT code that the review node must ACCEPT.
 * Each carries an EXPLICIT scope boundary or an INTENTIONAL, spec-sanctioned pattern, so ANY
 * FAIL here is an unambiguous OVER-REJECTION (the reviewer ignored a stated non-goal / flagged a
 * deliberately-chosen pattern / hallucinated a defect), NOT a real edge-case catch.
 *
 * The labeling discipline (js-oneline lesson): a case is only `accept` if the code is correct
 * INCLUDING its edges *within the stated scope*. The scope note is part of the contract.
 */
import type { Case } from './cases';

const bp = (criteria: string[], prose = ''): string =>
  `${prose ? prose + '\n\n' : ''}ACCEPTANCE CRITERIA:\n${criteria.map((c) => `- ${c}`).join('\n')}`;

export const SONNET: Case[] = [
  {
    id: 'S-intentional-no-await-ok',
    lang: 'ts', concept: 'intentional-fire-and-forget', complexity: 'medium', expected: 'accept',
    title: 'Fire-and-forget metrics emit',
    description: 'emitMetric must NOT be awaited — it is best-effort background telemetry on the hot path.',
    blueprint: bp([
      'track() calls emitMetric(event) WITHOUT awaiting it (fire-and-forget)',
      'track() returns immediately after enqueuing, not after the emit resolves',
    ], 'INTENTIONAL: emitMetric is fire-and-forget by design — awaiting it would block the hot path. Do NOT add await.'),
    base: {
      'src/track.ts':
`export async function emitMetric(event: string): Promise<void> {
  // network send, may be slow
}

export function track(event: string): void {
}
`,
    },
    after: {
      'src/track.ts':
`export async function emitMetric(event: string): Promise<void> {
  // network send, may be slow
}

export function track(event: string): void {
  // fire-and-forget: do not await — telemetry must never block the caller
  void emitMetric(event);
}
`,
    },
  },
  {
    id: 'S-intentional-mutation-ok',
    lang: 'ts', concept: 'intentional-in-place-mutation', complexity: 'medium', expected: 'accept',
    title: 'Sort the buffer in place',
    description: 'sortInPlace mutates the caller-owned array by design (perf: no copy).',
    blueprint: bp([
      'sortInPlace(buf) sorts buf ascending IN PLACE and returns the same array reference',
    ], 'INTENTIONAL: in-place mutation is the contract (large hot-path buffers must not be copied). Returning a new array would be WRONG.'),
    base: { 'src/sortbuf.ts': `export function sortInPlace(buf: number[]): number[] {\n  return buf;\n}\n` },
    after: { 'src/sortbuf.ts': `export function sortInPlace(buf: number[]): number[] {\n  buf.sort((a, b) => a - b);\n  return buf;\n}\n` },
  },
  {
    id: 'S-intentional-empty-catch-ok',
    lang: 'ts', concept: 'intentional-swallow', complexity: 'medium', expected: 'accept',
    title: 'Best-effort cache warm',
    description: 'warmCache swallows errors on purpose — a failed warm must never surface.',
    blueprint: bp([
      'warmCache(keys) attempts to load each key and SWALLOWS any error (best-effort, never throws)',
    ], 'INTENTIONAL: the empty catch is the contract — warming is advisory and must not propagate failures.'),
    base: {
      'src/warm.ts':
`declare function load(k: string): Promise<void>;
export async function warmCache(keys: string[]): Promise<void> {
}
`,
    },
    after: {
      'src/warm.ts':
`declare function load(k: string): Promise<void>;
export async function warmCache(keys: string[]): Promise<void> {
  for (const k of keys) {
    try {
      await load(k);
    } catch {
      // best-effort: a failed warm is advisory and must never surface
    }
  }
}
`,
    },
  },
  {
    id: 'S-loose-eq-nullish-ok',
    lang: 'js', concept: 'intentional-loose-equality', complexity: 'simple', expected: 'accept',
    title: 'Nullish check via == null',
    description: 'isNullish uses == null to catch BOTH null and undefined — deliberate.',
    blueprint: bp([
      'isNullish(x) returns true for exactly null and undefined, using the `== null` idiom',
    ], 'INTENTIONAL: `== null` is the idiom that matches null AND undefined; `=== null` would be WRONG here. Do not "fix" to ===.'),
    base: { 'nullish.js': `function isNullish(x) {\n  return false;\n}\nmodule.exports = { isNullish };\n` },
    after: { 'nullish.js': `function isNullish(x) {\n  return x == null; // matches null and undefined by design\n}\nmodule.exports = { isNullish };\n` },
  },
  {
    id: 'S-documented-magic-ok',
    lang: 'go', concept: 'documented-constant', complexity: 'simple', expected: 'accept',
    title: 'Convert days to seconds',
    description: 'Uses 86400 seconds/day, documented.',
    blueprint: bp([
      'DaysToSeconds(d) returns d * 86400',
    ]),
    base: { 'time.go': `package t

func DaysToSeconds(d int64) int64 {
	return 0
}
` },
    after: { 'time.go': `package t

const secondsPerDay = 86400 // 24 * 60 * 60

func DaysToSeconds(d int64) int64 {
	return d * secondsPerDay
}
` },
  },
  {
    id: 'S-bitwise-odd-ok',
    lang: 'c', concept: 'intentional-bitwise', complexity: 'simple', expected: 'accept',
    title: 'isOdd via bitwise and',
    description: 'Correct low-bit test.',
    blueprint: bp([
      'is_odd(n) returns 1 when n is odd and 0 when even, using a bitwise test',
    ], 'INTENTIONAL: `n & 1` is the chosen implementation; it is correct for all int inputs including negatives in two\'s complement.'),
    base: { 'odd.c': `int is_odd(int n) {\n    return 0;\n}\n` },
    after: { 'odd.c': `int is_odd(int n) {\n    return n & 1;\n}\n` },
  },
  {
    id: 'S-epsilon-compare-ok',
    lang: 'python', concept: 'float-epsilon', complexity: 'medium', expected: 'accept',
    title: 'approx_equal with epsilon',
    description: 'Compares floats within 1e-9.',
    blueprint: bp([
      'approx_equal(a, b) returns True when abs(a - b) <= 1e-9',
    ]),
    base: { 'approx.py': `def approx_equal(a, b):\n    return a == b\n` },
    after: { 'approx.py': `def approx_equal(a, b):\n    return abs(a - b) <= 1e-9\n` },
  },
  {
    id: 'S-nongoal-validation-ok',
    lang: 'ts', concept: 'stated-nongoal', complexity: 'medium', expected: 'accept',
    title: 'Compute the checkout total',
    description: 'Caller guarantees valid, positive line items; validation is a stated non-goal.',
    blueprint: bp([
      'checkoutTotal(items) returns the sum of price*qty across items',
    ], 'NON-GOALS: input validation is out of scope — the caller guarantees every item has a positive numeric price and qty. Do NOT add validation.'),
    base: {
      'src/checkout.ts':
`export interface Item { price: number; qty: number; }
export function checkoutTotal(items: Item[]): number {
  return 0;
}
`,
    },
    after: {
      'src/checkout.ts':
`export interface Item { price: number; qty: number; }
export function checkoutTotal(items: Item[]): number {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0);
}
`,
    },
  },
  {
    id: 'S-labeled-break-ok',
    lang: 'java', concept: 'labeled-break', complexity: 'complex', expected: 'accept',
    title: 'Find first matching pair with a labeled break',
    description: 'Uses a labeled break to exit nested loops — correct and idiomatic.',
    blueprint: bp([
      'firstPair(a, target) returns the first (i,j) with a[i]+a[j]==target as an int[]{i,j}, or {-1,-1}',
      'the search exits both loops as soon as a match is found',
    ], 'INTENTIONAL: a labeled break is the chosen control-flow to leave the nested loop; it is correct.'),
    base: {
      'Pairs.java':
`public class Pairs {
    public static int[] firstPair(int[] a, int target) {
        return new int[]{-1, -1};
    }
}
`,
    },
    after: {
      'Pairs.java':
`public class Pairs {
    public static int[] firstPair(int[] a, int target) {
        int[] res = new int[]{-1, -1};
        outer:
        for (int i = 0; i < a.length; i++) {
            for (int j = i + 1; j < a.length; j++) {
                if (a[i] + a[j] == target) {
                    res[0] = i;
                    res[1] = j;
                    break outer;
                }
            }
        }
        return res;
    }
}
`,
    },
  },
  {
    id: 'S-narrow-fix-in-noise-ok',
    lang: 'ts', concept: 'narrow-fix-large-file', complexity: 'complex', expected: 'accept',
    title: 'Fix the tier threshold comparison',
    description: 'One-line correct fix (>= instead of >) buried in a large, unrelated pricing module.',
    blueprint: bp([
      'tierFor(spend) returns "gold" when spend is AT LEAST 1000 (>= 1000), not strictly greater',
    ], 'Only the gold threshold comparison changes. The rest of the module is out of scope and correct.'),
    base: {
      'src/pricing.ts':
`export interface Plan { name: string; base: number; }

const PLANS: Plan[] = [
  { name: 'free', base: 0 },
  { name: 'pro', base: 20 },
  { name: 'team', base: 80 },
];

export function planByName(name: string): Plan | undefined {
  return PLANS.find((p) => p.name === name);
}

export function annualize(monthly: number): number {
  // two months free on annual billing
  return monthly * 10;
}

export function tierFor(spend: number): string {
  if (spend > 1000) return 'gold';
  if (spend >= 250) return 'silver';
  return 'bronze';
}

export function discountFor(tier: string): number {
  switch (tier) {
    case 'gold': return 0.2;
    case 'silver': return 0.1;
    default: return 0;
  }
}
`,
    },
    after: {
      'src/pricing.ts':
`export interface Plan { name: string; base: number; }

const PLANS: Plan[] = [
  { name: 'free', base: 0 },
  { name: 'pro', base: 20 },
  { name: 'team', base: 80 },
];

export function planByName(name: string): Plan | undefined {
  return PLANS.find((p) => p.name === name);
}

export function annualize(monthly: number): number {
  // two months free on annual billing
  return monthly * 10;
}

export function tierFor(spend: number): string {
  if (spend >= 1000) return 'gold';
  if (spend >= 250) return 'silver';
  return 'bronze';
}

export function discountFor(tier: string): number {
  switch (tier) {
    case 'gold': return 0.2;
    case 'silver': return 0.1;
    default: return 0;
  }
}
`,
    },
  },
  {
    id: 'S-early-return-noresource-ok',
    lang: 'python', concept: 'early-return-looks-like-leak', complexity: 'medium', expected: 'accept',
    title: 'Parse header, early-return on blank',
    description: 'Early return before any resource is opened — no leak, though it superficially resembles one.',
    blueprint: bp([
      'parse_header(line) returns None for a blank/whitespace-only line',
      'otherwise it returns the (key, value) split on the first colon',
    ]),
    base: { 'hdr.py': `def parse_header(line):\n    return None\n` },
    after: { 'hdr.py': `def parse_header(line):\n    if not line.strip():\n        return None\n    key, _, value = line.partition(":")\n    return (key.strip(), value.strip())\n` },
  },
  {
    id: 'S-const-time-compare-ok',
    lang: 'python', concept: 'constant-time-security', complexity: 'complex', expected: 'accept',
    title: 'Compare tokens in constant time',
    description: 'Uses hmac.compare_digest by design (timing-safe); a plain == would be the wrong, insecure choice.',
    blueprint: bp([
      'tokens_match(a, b) compares the two tokens in constant time using hmac.compare_digest',
    ], 'INTENTIONAL: constant-time comparison is a security requirement; `a == b` would be WRONG (timing leak).'),
    base: { 'tok.py': `import hmac\n\n\ndef tokens_match(a, b):\n    return False\n` },
    after: { 'tok.py': `import hmac\n\n\ndef tokens_match(a, b):\n    return hmac.compare_digest(a, b)\n` },
  },
];
