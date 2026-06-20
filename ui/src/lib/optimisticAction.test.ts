import { describe, it, expect } from 'vitest';
import {
  UNDO_MS,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  beginOptimistic,
  reconcile,
  canUndo,
  applyUndo,
  snooze,
  isSnoozed,
  markOnlyYou,
  outrank,
  validateThreshold,
  type PendingAction,
  type Markable,
} from './optimisticAction';

const NOW = 1_000_000;

const pending = (over: Partial<PendingAction> = {}): PendingAction =>
  ({
    id: 'a1',
    kind: 'clear',
    toastLabel: 'sent → cleared',
    issuedAt: NOW,
    undoUntil: NOW + UNDO_MS,
    status: 'pending',
    ...over,
  }) as PendingAction;

const mkItem = (over: Partial<Markable> = {}): Markable =>
  ({ id: 'i1', onlyYou: false, createdAt: NOW, ...over });

describe('beginOptimistic', () => {
  it('returns status pending with issuedAt and undoUntil', () => {
    const a = beginOptimistic('x1', 'clear', NOW);
    expect(a.status).toBe('pending');
    expect(a.issuedAt).toBe(NOW);
    expect(a.undoUntil).toBe(NOW + UNDO_MS);
    expect(a.id).toBe('x1');
    expect(a.kind).toBe('clear');
  });

  it('default toastLabel contains "sent" and reflects the kind', () => {
    const c = beginOptimistic('x1', 'clear', NOW);
    expect(c.toastLabel).toContain('sent');
    expect(c.toastLabel.toLowerCase()).toContain('clear');

    const m = beginOptimistic('x2', 'mark', NOW);
    expect(m.toastLabel).toContain('sent');
    expect(m.toastLabel.toLowerCase()).toContain('mark');

    const s = beginOptimistic('x3', 'snooze', NOW);
    expect(s.toastLabel).toContain('sent');
    expect(s.toastLabel.toLowerCase()).toContain('snooze');
  });

  it('custom label is honored', () => {
    const a = beginOptimistic('x1', 'clear', NOW, 'custom label');
    expect(a.toastLabel).toBe('custom label');
  });
});

describe('reconcile (confirm-on-ok)', () => {
  it('serverOk=true → confirmed', () => {
    const a = reconcile(pending(), true);
    expect(a.status).toBe('confirmed');
  });

  it('serverOk=false → reverted', () => {
    const a = reconcile(pending(), false);
    expect(a.status).toBe('reverted');
  });

  it('reconciling an undone action is a no-op (idempotent)', () => {
    const undone = pending({ status: 'undone' });
    expect(reconcile(undone, true).status).toBe('undone');
    expect(reconcile(undone, false).status).toBe('undone');
  });
});

describe('canUndo / applyUndo (5s window, boundary)', () => {
  it('now === undoUntil → still undoable (inclusive boundary)', () => {
    const a = pending({ undoUntil: NOW + UNDO_MS });
    expect(canUndo(a, NOW + UNDO_MS)).toBe(true);
  });

  it('applyUndo at boundary → status undone', () => {
    const a = pending({ undoUntil: NOW + UNDO_MS });
    expect(applyUndo(a, NOW + UNDO_MS).status).toBe('undone');
  });

  it('now === undoUntil + 1 → NOT undoable', () => {
    const a = pending({ undoUntil: NOW + UNDO_MS });
    expect(canUndo(a, NOW + UNDO_MS + 1)).toBe(false);
  });

  it('applyUndo past boundary returns action unchanged', () => {
    const a = pending({ undoUntil: NOW + UNDO_MS });
    const result = applyUndo(a, NOW + UNDO_MS + 1);
    expect(result.status).toBe('pending');
  });

  it('canUndo false once status is confirmed even inside window', () => {
    const a = pending({ status: 'confirmed', undoUntil: NOW + UNDO_MS });
    expect(canUndo(a, NOW)).toBe(false);
  });
});

describe('snooze / isSnoozed', () => {
  it('snooze returns now + ms', () => {
    expect(snooze(NOW, 10_000)).toBe(NOW + 10_000);
  });

  it('before expiry → snoozed', () => {
    expect(isSnoozed(NOW + 10_000, NOW + 5_000)).toBe(true);
  });

  it('at expiry (now === snoozedUntil) → NOT snoozed (re-surfaces)', () => {
    expect(isSnoozed(NOW + 10_000, NOW + 10_000)).toBe(false);
  });

  it('after expiry → not snoozed', () => {
    expect(isSnoozed(NOW + 10_000, NOW + 10_001)).toBe(false);
  });

  it('undefined snoozedUntil → never snoozed', () => {
    expect(isSnoozed(undefined, NOW)).toBe(false);
  });
});

describe('markOnlyYou (operator-gated)', () => {
  it('operator=true → onlyYou set to true', () => {
    const item = mkItem({ onlyYou: false });
    expect(markOnlyYou(item, true).onlyYou).toBe(true);
  });

  it('operator=false → item returned unchanged (no privilege escalation)', () => {
    const item = mkItem({ onlyYou: false });
    const result = markOnlyYou(item, false);
    expect(result).toBe(item);
    expect(result.onlyYou).toBe(false);
  });
});

describe('outrank (deterministic total order)', () => {
  it('onlyYou item sorts before a non-onlyYou item', () => {
    const a = mkItem({ id: 'a', onlyYou: true, createdAt: NOW });
    const b = mkItem({ id: 'b', onlyYou: false, createdAt: NOW });
    expect(outrank(a, b)).toBeLessThan(0);
    expect(outrank(b, a)).toBeGreaterThan(0);
  });

  it('equal onlyYou flag: older createdAt sorts first', () => {
    const older = mkItem({ id: 'a', onlyYou: false, createdAt: NOW - 1000 });
    const newer = mkItem({ id: 'b', onlyYou: false, createdAt: NOW });
    expect(outrank(older, newer)).toBeLessThan(0);
    expect(outrank(newer, older)).toBeGreaterThan(0);
  });

  it('equal onlyYou and createdAt: id ascending (stable tiebreak)', () => {
    const a = mkItem({ id: 'aaa', onlyYou: false, createdAt: NOW });
    const b = mkItem({ id: 'bbb', onlyYou: false, createdAt: NOW });
    expect(outrank(a, b)).toBeLessThan(0);
    expect(outrank(b, a)).toBeGreaterThan(0);
  });

  it('sorting an array twice yields identical order (determinism)', () => {
    const items: Markable[] = [
      mkItem({ id: 'c', onlyYou: false, createdAt: NOW }),
      mkItem({ id: 'a', onlyYou: true, createdAt: NOW + 1000 }),
      mkItem({ id: 'b', onlyYou: false, createdAt: NOW - 500 }),
    ];
    const first = [...items].sort(outrank).map(i => i.id);
    const second = [...items].sort(outrank).map(i => i.id);
    expect(first).toEqual(second);
  });
});

describe('validateThreshold', () => {
  it('in-range value → ok=true, clamped equals input', () => {
    const mid = Math.floor((MIN_THRESHOLD + MAX_THRESHOLD) / 2);
    expect(validateThreshold(mid)).toEqual({ ok: true, clamped: mid });
  });

  it('exactly MIN_THRESHOLD → ok=true', () => {
    expect(validateThreshold(MIN_THRESHOLD)).toEqual({ ok: true, clamped: MIN_THRESHOLD });
  });

  it('exactly MAX_THRESHOLD → ok=true', () => {
    expect(validateThreshold(MAX_THRESHOLD)).toEqual({ ok: true, clamped: MAX_THRESHOLD });
  });

  it('below MIN_THRESHOLD → ok=false, clamped up to MIN', () => {
    const result = validateThreshold(MIN_THRESHOLD - 1);
    expect(result.ok).toBe(false);
    expect(result.clamped).toBe(MIN_THRESHOLD);
  });

  it('above MAX_THRESHOLD → ok=false, clamped down to MAX', () => {
    const result = validateThreshold(MAX_THRESHOLD + 1);
    expect(result.ok).toBe(false);
    expect(result.clamped).toBe(MAX_THRESHOLD);
  });

  it('NaN → ok=false, clamped to a finite bound', () => {
    const result = validateThreshold(NaN);
    expect(result.ok).toBe(false);
    expect(Number.isFinite(result.clamped)).toBe(true);
  });

  it('Infinity → ok=false, clamped to a finite bound', () => {
    const result = validateThreshold(Infinity);
    expect(result.ok).toBe(false);
    expect(Number.isFinite(result.clamped)).toBe(true);
  });

  it('-Infinity → ok=false, clamped to a finite bound', () => {
    const result = validateThreshold(-Infinity);
    expect(result.ok).toBe(false);
    expect(Number.isFinite(result.clamped)).toBe(true);
  });
});
