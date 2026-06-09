/**
 * Unit tests for src/services/grok-triage.ts — the single-shot Grok classifier.
 *
 * Pure: all IO (getTodo/getDeps/commitsBehindMaster/callGrok) is injected, so no
 * network or DB is touched.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseVerdict,
  deriveAct,
  classifyEscalation,
  NOW_BUILDABLE_MIN_CONFIDENCE,
  OVERRIDE_MIN_CONFIDENCE,
  type TriageDeps,
} from '../grok-triage';
import type { Escalation } from '../supervisor-store';

function esc(overrides: Partial<Escalation> = {}): Escalation {
  return {
    id: 'e1',
    project: '/p',
    session: 'worker-1',
    kind: 'blocker',
    questionText: 'dep not done?',
    status: 'open',
    createdAt: 0,
    resolvedAt: null,
    serverId: '',
    todoId: 't1',
    options: null,
    recommended: null,
    ui: null,
    routedTo: 'human',
    operatorGated: 0,
    proof: null,
    stewardAttempts: 0,
    suggestedAction: null,
    ...overrides,
  };
}

const todoView = {
  id: 't1', title: 'do thing', status: 'blocked', retryCount: 3,
  acceptanceStatus: null, dependsOn: ['d1'], type: 'backend',
  targetProject: null, updatedAt: '2026-06-09T00:00:00.000Z',
};

function depsWith(reply: string, extra: Partial<TriageDeps> = {}): TriageDeps {
  return {
    getTodo: () => todoView,
    getDeps: () => [{ id: 'd1', status: 'done', acceptanceStatus: 'accepted' }],
    listRecentAudit: () => [],
    commitsBehindMaster: () => 0,
    callGrok: async () => reply,
    ...extra,
  };
}

describe('parseVerdict', () => {
  it('parses a clean JSON verdict', () => {
    expect(parseVerdict('{"bucket":"now-buildable","confidence":0.9,"rationale":"deps done"}'))
      .toEqual({ bucket: 'now-buildable', confidence: 0.9, rationale: 'deps done' });
  });

  it('extracts JSON from surrounding prose / code fence', () => {
    const raw = 'Here is my verdict:\n```json\n{"bucket":"stale","confidence":0.5,"rationale":"old"}\n```';
    expect(parseVerdict(raw)?.bucket).toBe('stale');
  });

  it('clamps confidence to 0..1', () => {
    expect(parseVerdict('{"bucket":"stale","confidence":5,"rationale":"x"}')?.confidence).toBe(1);
    expect(parseVerdict('{"bucket":"stale","confidence":-2,"rationale":"x"}')?.confidence).toBe(0);
  });

  it('returns null on an unknown bucket', () => {
    expect(parseVerdict('{"bucket":"banana","confidence":0.9,"rationale":"x"}')).toBeNull();
  });

  it('returns null on malformed / empty input', () => {
    expect(parseVerdict('not json')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });
});

describe('deriveAct', () => {
  it('now-buildable → reset_todo + dep-done proof', () => {
    expect(deriveAct('now-buildable')).toEqual({
      verb: 'reset_todo',
      args: { proof: { kind: 'dep-done' }, status: 'ready' },
    });
  });

  it('verified-done WITH an artifact → override_accept_todo + override-clean proof', () => {
    expect(deriveAct('verified-done', 'src/foo.ts')).toEqual({
      verb: 'override_accept_todo',
      args: { proof: { kind: 'override-clean', artifactPath: 'src/foo.ts' } },
    });
    // A bare symbol (no slash/extension) → artifactSymbol.
    expect(deriveAct('verified-done', 'MyExportedThing')).toEqual({
      verb: 'override_accept_todo',
      args: { proof: { kind: 'override-clean', artifactSymbol: 'MyExportedThing' } },
    });
  });

  it('verified-done WITHOUT an artifact → classify-only', () => {
    expect(deriveAct('verified-done')).toEqual({ verb: null, args: null });
  });

  it('every non-actionable bucket → classify-only (no verb)', () => {
    for (const b of ['stale', 'genuine-decision', 'needs-design'] as const) {
      expect(deriveAct(b)).toEqual({ verb: null, args: null });
    }
  });
});

describe('classifyEscalation', () => {
  it('now-buildable with high confidence → actionable reset_todo suggestion', async () => {
    const s = await classifyEscalation('/p', esc(), depsWith(
      '{"bucket":"now-buildable","confidence":0.95,"rationale":"all deps accepted"}',
    ));
    expect(s?.bucket).toBe('now-buildable');
    expect(s?.verb).toBe('reset_todo');
    expect(s?.args).toEqual({ proof: { kind: 'dep-done' }, status: 'ready' });
    // bundleInputs captures provenance.
    expect(s?.bundleInputs.todoUpdatedAt).toBe(todoView.updatedAt);
  });

  it('LOW-confidence now-buildable is downgraded to classify-only (no auto-act)', async () => {
    const low = NOW_BUILDABLE_MIN_CONFIDENCE - 0.1;
    const s = await classifyEscalation('/p', esc(), depsWith(
      `{"bucket":"now-buildable","confidence":${low},"rationale":"maybe"}`,
    ));
    expect(s?.bucket).toBe('now-buildable');
    expect(s?.verb).toBeNull(); // downgraded
  });

  it('verified-done WITH artifact + high confidence → override_accept_todo suggestion', async () => {
    const s = await classifyEscalation('/p', esc(), depsWith(
      '{"bucket":"verified-done","confidence":0.95,"rationale":"deliverable in tree","artifact":"src/foo.ts"}',
    ));
    expect(s?.bucket).toBe('verified-done');
    expect(s?.verb).toBe('override_accept_todo');
    expect(s?.args).toEqual({ proof: { kind: 'override-clean', artifactPath: 'src/foo.ts' } });
  });

  it('verified-done below the OVERRIDE bar → downgraded to classify-only', async () => {
    const low = OVERRIDE_MIN_CONFIDENCE - 0.05;
    const s = await classifyEscalation('/p', esc(), depsWith(
      `{"bucket":"verified-done","confidence":${low},"rationale":"maybe","artifact":"src/foo.ts"}`,
    ));
    expect(s?.bucket).toBe('verified-done');
    expect(s?.verb).toBeNull(); // override is the scary verb — held to a higher bar
  });

  it('genuine-decision → classify-only, routes attention', async () => {
    const s = await classifyEscalation('/p', esc(), depsWith(
      '{"bucket":"genuine-decision","confidence":0.8,"rationale":"product A/B"}',
    ));
    expect(s?.bucket).toBe('genuine-decision');
    expect(s?.verb).toBeNull();
    expect(s?.rationale).toBe('product A/B');
  });

  it('fails OPEN (null) when Grok throws', async () => {
    const s = await classifyEscalation('/p', esc(), depsWith('', {
      callGrok: async () => { throw new Error('network'); },
    }));
    expect(s).toBeNull();
  });

  it('fails OPEN (null) on a malformed verdict', async () => {
    const s = await classifyEscalation('/p', esc(), depsWith('garbage not json'));
    expect(s).toBeNull();
  });
});
