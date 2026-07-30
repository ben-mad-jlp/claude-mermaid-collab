import { describe, expect, it } from 'vitest';
import { detectForwardAccrual, toOneShot } from '../criterion-closeability';

const POSITIVE: string[] = [
  'holds over ≥5 live mission passes',
  'the criterion holds over at least 3 future events',
  'the fix must hold over the next 10 conductor passes',
  'stability must be proven for the next 5 releases',
  'the daemon continues to reconcile missions correctly',
  'the behavior is correct going forward',
  'every criterion must be graded at HEAD from now on',
  'the improvement must be sustained over multiple deploys',
];

const NEGATIVE: string[] = [
  'proven by a test asserting 3 of 3 recorded runs',
  'measured at 94.8% on the recorded sample',
  'the last conductor pass emitted the card',
  'verified once by mutation-probe evidence',
  'the criterion was met at commit d2694377',
  'observed in the ledger for pass 12',
];

describe('detectForwardAccrual', () => {
  it("detects the literal accrual phrase 'holds over ≥5 live mission passes'", () => {
    expect(detectForwardAccrual('holds over ≥5 live mission passes')).not.toBeNull();
  });

  it('matches every POSITIVE fixture and rejects every NEGATIVE fixture', () => {
    for (const s of POSITIVE) {
      expect(detectForwardAccrual(s), `expected match for: ${s}`).not.toBeNull();
    }
    for (const s of NEGATIVE) {
      expect(detectForwardAccrual(s), `expected no match for: ${s}`).toBeNull();
    }
  });

  it('toOneShot clears detectForwardAccrual for every POSITIVE fixture and is idempotent', () => {
    for (const s of POSITIVE) {
      const rewritten = toOneShot(s);
      expect(detectForwardAccrual(rewritten), `expected clean rewrite for: ${s} -> ${rewritten}`).toBeNull();
      const rewrittenTwice = toOneShot(rewritten);
      expect(rewrittenTwice, `expected idempotence for: ${s}`).toBe(rewritten);
    }
  });
});
