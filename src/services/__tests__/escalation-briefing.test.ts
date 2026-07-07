// Runs via `bun test` (uses bun:sqlite). Isolates the global supervisor.db via
// MERMAID_SUPERVISOR_DIR so it never touches the real ~/.mermaid-collab one.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEscalation, getEscalation, _closeDb } from '../supervisor-store.ts';
import { generateBriefingMarkdown, briefEscalation, BRIEFING_SYSTEM_PROMPT } from '../escalation-briefing.ts';
import type { Escalation } from '../supervisor-store.ts';

const PROJECT = '/tmp/nonexistent-briefing-project'; // packBundle reads are best-effort → tolerate absent repo

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'esc-brief-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeDb();
});
afterEach(() => {
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const GOOD_MD = '## Decision\nPick A or B.\n\n## Situation\nx\n\n## System context\ny\n\n## Recommendation\n_Steward’s recommendation — a suggestion, not a fact:_ do A.';

function fakeEsc(over: Partial<Escalation> = {}): Escalation {
  return {
    id: 'e1', project: PROJECT, session: 's', kind: 'genuine-decision',
    questionText: 'Ship now or wait?', status: 'open', createdAt: 0, resolvedAt: null,
    serverId: '', todoId: null, options: null, recommended: null, ui: null,
    routedTo: 'human', operatorGated: 0, proof: null, stewardAttempts: 0,
    suggestedAction: null, triageInFlight: false, resolvedBy: null,
    briefingMd: null, briefingModel: null, briefingAt: null, ...over,
  };
}

test('generateBriefingMarkdown returns the LLM markdown when the call succeeds', async () => {
  const { md, model } = await generateBriefingMarkdown(PROJECT, fakeEsc(), {
    callLLM: async () => GOOD_MD, modelLabel: 'xai/grok-build-0.1',
  });
  expect(md).toBe(GOOD_MD);
  expect(model).toBe('xai/grok-build-0.1');
});

test('fails open to the deterministic floor when the LLM throws', async () => {
  const { md, model } = await generateBriefingMarkdown(PROJECT, fakeEsc(), {
    callLLM: async () => { throw new Error('llm down'); }, modelLabel: 'm',
  });
  expect(md).toContain('## Decision'); // floor renderer always emits sections
  expect(md).toContain('Ship now or wait?');
  expect(model).toContain('fallback');
});

test('fails open when the LLM returns empty / non-markdown', async () => {
  const { md, model } = await generateBriefingMarkdown(PROJECT, fakeEsc(), {
    callLLM: async () => '   ', modelLabel: 'm',
  });
  expect(md).toContain('## Decision');
  expect(model).toContain('fallback');
});

test('the prompt grounds the model on the FIXED options (never invent)', async () => {
  let seenUser = '';
  await generateBriefingMarkdown(PROJECT, fakeEsc({
    options: [{ id: 'a', label: 'Ship now' }, { id: 'b', label: 'Wait for review' }] as Escalation['options'],
  }), { callLLM: async (_sys, user) => { seenUser = user; return GOOD_MD; } });
  expect(seenUser).toContain('id=a: Ship now');
  expect(seenUser).toContain('id=b: Wait for review');
  expect(seenUser).toContain('do NOT invent');
  // System prompt enforces the guardrails.
  expect(BRIEFING_SYSTEM_PROMPT).toContain('the options are fixed');
});

test('briefEscalation generates once, then serves from cache; refresh regenerates', async () => {
  const { escalation } = createEscalation({ project: PROJECT, session: 's', kind: 'genuine-decision', questionText: 'q?' });
  let calls = 0;
  const deps = { callLLM: async () => { calls++; return `## Decision\ncall#${calls}\n\n## Situation\n\n## System context\n\n## Recommendation\n`; }, modelLabel: 'm' };

  const first = await briefEscalation(PROJECT, escalation.id, { deps });
  expect(first.cached).toBe(false);
  expect(calls).toBe(1);
  expect(getEscalation(escalation.id)!.briefingMd).toContain('call#1'); // persisted

  const second = await briefEscalation(PROJECT, escalation.id, { deps });
  expect(second.cached).toBe(true);
  expect(calls).toBe(1); // no new LLM call

  const refreshed = await briefEscalation(PROJECT, escalation.id, { refresh: true, deps });
  expect(refreshed.cached).toBe(false);
  expect(calls).toBe(2);
  expect(refreshed.md).toContain('call#2');
});

test('briefEscalation throws on an unknown escalation id', async () => {
  await expect(briefEscalation(PROJECT, 'nope', {})).rejects.toThrow('escalation not found');
});
