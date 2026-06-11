import { describe, it, expect } from 'vitest';
import type { Escalation, SuggestedAction } from '@/stores/supervisorStore';
import {
  classifyEscalationLifecycle,
  lifecyclePresentation,
  isTriaging,
  isEscalatedToHuman,
  isAiResolved,
  selectRecentlyAiResolved,
} from './escalationLifecycle';

const suggestion: SuggestedAction = {
  bucket: 'now-buildable',
  verb: 'reset_todo',
  confidence: 0.9,
  rationale: 'deps are done; reset to ready',
};

function esc(partial: Partial<Escalation>): Escalation {
  return {
    id: 'e1',
    project: '/p',
    session: 's',
    kind: 'blocker',
    questionText: 'q',
    status: 'open',
    createdAt: 1,
    ...partial,
  };
}

describe('classifyEscalationLifecycle', () => {
  it('open: raised, untriaged (no AI signal, no human routing)', () => {
    expect(classifyEscalationLifecycle(esc({}))).toBe('open');
  });

  it('ai-handling: a Grok consult is in flight (wins over everything else while open)', () => {
    expect(classifyEscalationLifecycle(esc({ triageInFlight: true }))).toBe('ai-handling');
    // even if a suggestion/attempt is also present, in-flight is the current state
    expect(
      classifyEscalationLifecycle(esc({ triageInFlight: true, suggestedAction: suggestion, stewardAttempts: 1 })),
    ).toBe('ai-handling');
  });

  it('escalated-to-human: routedTo steward (Grok tried, deferred) — still open', () => {
    expect(classifyEscalationLifecycle(esc({ routedTo: 'steward' }))).toBe('escalated-to-human');
  });

  it('escalated-to-human: a steward attempt was burned without auto-resolving', () => {
    expect(classifyEscalationLifecycle(esc({ stewardAttempts: 2 }))).toBe('escalated-to-human');
  });

  it('ai-suggested: Grok classified it (propose), awaiting human confirm', () => {
    expect(classifyEscalationLifecycle(esc({ suggestedAction: suggestion }))).toBe('ai-suggested');
  });

  it('ai-resolved: server says the steward auto-resolved it', () => {
    expect(classifyEscalationLifecycle(esc({ status: 'resolved', resolvedBy: 'ai', resolvedAt: 5 }))).toBe('ai-resolved');
  });

  it('ai-resolved: heuristic fallback — suggestion + steward attempt + terminal', () => {
    expect(
      classifyEscalationLifecycle(esc({ status: 'resolved', suggestedAction: suggestion, stewardAttempts: 1 })),
    ).toBe('ai-resolved');
  });

  it('human-resolved: server says a person resolved it', () => {
    expect(classifyEscalationLifecycle(esc({ status: 'decided', resolvedBy: 'human' }))).toBe('human-resolved');
  });

  it('human-resolved: terminal with no AI provenance', () => {
    expect(classifyEscalationLifecycle(esc({ status: 'resolved' }))).toBe('human-resolved');
  });

  it('escalated-to-human takes precedence over a stale suggestion while open', () => {
    // Grok suggested AND then routed to human → the live state is needs-you.
    expect(
      classifyEscalationLifecycle(esc({ suggestedAction: suggestion, routedTo: 'steward' })),
    ).toBe('escalated-to-human');
  });
});

describe('lifecycle predicates + presentation', () => {
  it('predicates match the classifier', () => {
    expect(isTriaging(esc({ triageInFlight: true }))).toBe(true);
    expect(isEscalatedToHuman(esc({ routedTo: 'steward' }))).toBe(true);
    expect(isAiResolved(esc({ status: 'resolved', resolvedBy: 'ai' }))).toBe(true);
    expect(isTriaging(esc({}))).toBe(false);
  });

  it('presentation: only ai-handling shows a spinner', () => {
    expect(lifecyclePresentation(esc({ triageInFlight: true })).spinner).toBe(true);
    expect(lifecyclePresentation(esc({})).spinner).toBe(false);
    expect(lifecyclePresentation(esc({ routedTo: 'steward' })).spinner).toBe(false);
  });

  it('presentation: labels carry the right token', () => {
    expect(lifecyclePresentation(esc({ routedTo: 'steward' })).token).toBe('escalated-to-human');
    expect(lifecyclePresentation(esc({ status: 'resolved', resolvedBy: 'ai' })).label).toBe('AI resolved');
  });
});

describe('selectRecentlyAiResolved', () => {
  const now = 1_000_000;
  it('returns AI-resolved items resolved within the window, newest first', () => {
    const resolved = [
      esc({ id: 'old', status: 'resolved', resolvedBy: 'ai', resolvedAt: now - 200_000 }), // too old
      esc({ id: 'fresh1', status: 'resolved', resolvedBy: 'ai', resolvedAt: now - 10_000 }),
      esc({ id: 'fresh2', status: 'resolved', resolvedBy: 'ai', resolvedAt: now - 1_000 }),
      esc({ id: 'human', status: 'resolved', resolvedBy: 'human', resolvedAt: now - 1_000 }), // not AI
    ];
    expect(selectRecentlyAiResolved(resolved, now, 90_000).map((e) => e.id)).toEqual(['fresh2', 'fresh1']);
  });

  it('excludes items with no resolvedAt', () => {
    expect(selectRecentlyAiResolved([esc({ status: 'resolved', resolvedBy: 'ai' })], now)).toEqual([]);
  });
});
