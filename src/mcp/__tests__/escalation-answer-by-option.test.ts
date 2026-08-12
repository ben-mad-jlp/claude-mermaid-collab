import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'escalation-answer-by-option-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  getEscalation,
  getEscalationDecision,
  _closeDb,
} from '../../services/supervisor-store.ts';
import { awaitHumanDecision } from '../../services/decision-relay.ts';
import { handleSupervisorTool } from '../supervisor-tools.js';
import { WAKE_CARD_EXCERPT_CHARS } from '../../services/conductor-pass.js';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('escalation_resolve with optionId', () => {
  it('resolves a valid optionId, refuses an unoffered one leaving the card open, and returns the full untruncated questionText via escalation_get before and after resolution', async () => {
    // Assertion (1): Create an options-bearing escalation with long questionText
    const longText = 'A'.repeat(WAKE_CARD_EXCERPT_CHARS + 50);
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: longText,
      audience: 'internal',
      options: [
        { id: 'a', label: 'Approach A' },
        { id: 'b', label: 'Approach B' },
      ],
      recommended: 'a',
    });

    // Assertion (4): Verify escalation_get returns the full untruncated questionText immediately
    const getResult1Str = await handleSupervisorTool('escalation_get', { id: escalation.id });
    expect(getResult1Str).not.toBeNull();
    const getResult1 = JSON.parse(getResult1Str!);
    expect(getResult1.questionText).toBe(longText);
    expect(getResult1.questionText.length).toBe(WAKE_CARD_EXCERPT_CHARS + 50);

    // Assertion (1): Resolve with a valid optionId
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: escalation.id,
      status: 'decided',
      optionId: 'a',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    expect(resolveResult.success).toBe(true);
    expect(resolveResult.optionId).toBe('a');
    expect(resolveResult.status).toBe('decided');

    // Assertion (2): Verify the decision was recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision?.optionId).toBe('a');

    // Assertion (4): Verify escalation_get still returns the full untruncated questionText after resolution
    const getResult2Str = await handleSupervisorTool('escalation_get', { id: escalation.id });
    expect(getResult2Str).not.toBeNull();
    const getResult2 = JSON.parse(getResult2Str!);
    expect(getResult2.questionText).toBe(longText);
    expect(getResult2.questionText.length).toBe(WAKE_CARD_EXCERPT_CHARS + 50);
    expect(getResult2.decision?.optionId).toBe('a');

    // Assertion (2b): Test awaitHumanDecision on a second escalation
    const { escalation: escalation2 } = createEscalation({
      project: '/p',
      session: 's2',
      kind: 'decision',
      questionText: 'Choose one?',
      audience: 'internal',
      options: [
        { id: 'x', label: 'Option X' },
        { id: 'y', label: 'Option Y' },
      ],
    });

    // Resolve it with optionId
    const resolveResult2Str = await handleSupervisorTool('escalation_resolve', {
      id: escalation2.id,
      status: 'decided',
      optionId: 'x',
    });
    expect(resolveResult2Str).not.toBeNull();

    // Now await the decision
    const awaitResult = await awaitHumanDecision(escalation2.id, { timeoutMs: 100 });
    expect(awaitResult.optionId).toBe('x');
    expect(awaitResult.timedOut).toBe(false);
    expect(awaitResult.decided).toBe(true);
  });

  it('refuses an unoffered optionId and leaves the card open with no decision recorded', async () => {
    // Assertion (3): Create a fresh options-bearing escalation
    const { escalation } = createEscalation({
      project: '/p',
      session: 's3',
      kind: 'decision',
      questionText: 'Pick one',
      audience: 'internal',
      options: [
        { id: 'opt1', label: 'Option 1' },
        { id: 'opt2', label: 'Option 2' },
      ],
    });

    // Assertion (3): Try to resolve with an invalid optionId
    const refuseResultStr = await handleSupervisorTool('escalation_resolve', {
      id: escalation.id,
      status: 'decided',
      optionId: 'zzz',
    });
    expect(refuseResultStr).not.toBeNull();
    const refuseResult = JSON.parse(refuseResultStr!);
    expect(refuseResult.ok).toBe(false);
    expect(refuseResult.reason).toBe('invalid-option');

    // Assertion (3): Verify no decision was recorded
    const decision = getEscalationDecision(escalation.id);
    expect(decision).toBeNull();

    // Assertion (3): Verify the card is still open
    const getResultStr = await handleSupervisorTool('escalation_get', { id: escalation.id });
    expect(getResultStr).not.toBeNull();
    const getResult = JSON.parse(getResultStr!);
    expect(getResult.status).toBe('open');
  });

  it('still routes status/note path when optionId is absent', async () => {
    // Verify the original status/note path still works (no optionId)
    const { escalation } = createEscalation({
      project: '/p',
      session: 's4',
      kind: 'question',
      questionText: 'What now?',
      audience: 'internal',
    });

    // Resolve without optionId (no options on this escalation anyway)
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: escalation.id,
      status: 'resolved',
      note: 'Handled',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    expect(resolveResult.success).toBe(true);
    expect(resolveResult.status).toBe('resolved');
    expect(resolveResult.note).toBe('Handled');

    // Verify via escalation_get
    const getResultStr = await handleSupervisorTool('escalation_get', { id: escalation.id });
    expect(getResultStr).not.toBeNull();
    const getResult = JSON.parse(getResultStr!);
    expect(getResult.status).toBe('resolved');
    expect(getResult.resolutionNote).toBe('Handled');
  });

  it('resolves short ids and merges the decision', async () => {
    // Create an escalation and test short-id resolution
    const { escalation } = createEscalation({
      project: '/p',
      session: 's5',
      kind: 'decision',
      questionText: 'Short ID test',
      audience: 'internal',
      options: [
        { id: 'short', label: 'Short Option' },
      ],
    });

    const shortId = escalation.id.slice(0, 8);

    // Resolve using short id
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: shortId,
      status: 'decided',
      optionId: 'short',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    expect(resolveResult.success).toBe(true);

    // Get using short id
    const getResultStr = await handleSupervisorTool('escalation_get', { id: shortId });
    expect(getResultStr).not.toBeNull();
    const getResult = JSON.parse(getResultStr!);
    expect(getResult.decision?.optionId).toBe('short');
  });
});
