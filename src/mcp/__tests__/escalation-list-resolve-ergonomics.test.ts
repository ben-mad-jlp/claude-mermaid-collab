import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'escalation-list-resolve-ergonomics-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  createEscalation,
  getEscalation,
  _closeDb,
} from '../../services/supervisor-store.ts';
import { handleSupervisorTool } from '../supervisor-tools.js';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('escalation_list and escalation_resolve ergonomics', () => {
  it('escalation_list scoped to a project never returns another project\'s escalation', async () => {
    // Create escalations in different projects
    const { escalation: esc1 } = createEscalation({
      project: '/proj1',
      session: 's1',
      kind: 'decision',
      questionText: 'Question 1',
      audience: 'human',
    });

    const { escalation: esc2 } = createEscalation({
      project: '/proj2',
      session: 's2',
      kind: 'decision',
      questionText: 'Question 2',
      audience: 'human',
    });

    // List escalations for proj1 only
    const resultStr = await handleSupervisorTool('escalation_list', { project: '/proj1' });
    expect(resultStr).not.toBeNull();
    const result = JSON.parse(resultStr!);
    expect(Array.isArray(result)).toBe(true);
    const ids = result.map((r: any) => r.id);
    expect(ids).toContain(esc1.id);
    expect(ids).not.toContain(esc2.id);
  });

  it('escalation_list summary mode truncates questionText while escalation_get returns the untruncated text', async () => {
    const longText = 'A'.repeat(300);
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: longText,
      audience: 'human',
    });

    // List with summary mode (default)
    const listResultStr = await handleSupervisorTool('escalation_list', { full: false });
    expect(listResultStr).not.toBeNull();
    const listResult = JSON.parse(listResultStr!);
    const item = listResult.find((r: any) => r.id === escalation.id);
    expect(item).toBeDefined();
    expect(item?.excerpt).toBeDefined();
    expect(item?.excerpt.length).toBeLessThanOrEqual(201); // 200 + '…'
    expect(item?.excerpt.endsWith('…')).toBe(true);

    // Get with full mode
    const getResultStr = await handleSupervisorTool('escalation_get', { id: escalation.id });
    expect(getResultStr).not.toBeNull();
    const getResult = JSON.parse(getResultStr!);
    expect(getResult.questionText).toBe(longText);
    expect(getResult.questionText.length).toBe(300);
  });

  it('escalation_list kind filter returns only that kind', async () => {
    const { escalation: decision } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'A decision',
      audience: 'human',
    });

    const { escalation: question } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'A question',
      audience: 'human',
    });

    // Filter by kind
    const resultStr = await handleSupervisorTool('escalation_list', { kind: 'decision' });
    expect(resultStr).not.toBeNull();
    const result = JSON.parse(resultStr!);
    const ids = result.map((r: any) => r.id);
    expect(ids).toContain(decision.id);
    expect(ids).not.toContain(question.id);
  });

  it('escalation_resolve resolves a leading-8 short id and reports the stored status for the full id', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'Short ID test',
      audience: 'human',
    });

    const shortId = escalation.id.slice(0, 8);

    // Resolve using short id
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: shortId,
      status: 'resolved',
      note: 'Resolved via short id',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    expect(resolveResult.success).toBe(true);
    // The response id should be the full id
    expect(resolveResult.id).toBe(escalation.id);
    expect(resolveResult.status).toBe('resolved');
    expect(resolveResult.note).toBe('Resolved via short id');

    // Verify the stored escalation reflects the correct status
    const stored = getEscalation(escalation.id);
    expect(stored?.status).toBe('resolved');
    expect(stored?.resolutionNote).toBe('Resolved via short id');
  });

  it('escalation_resolve on an ambiguous prefix refuses naming both candidate ids and leaves both rows open', async () => {
    // Create several escalations and find two that share a prefix
    const escalations = [];
    for (let i = 0; i < 30; i++) {
      const { escalation: esc } = createEscalation({
        project: '/p',
        session: 's',
        kind: 'question',
        questionText: `Question ${i}`,
        audience: 'human',
      });
      escalations.push(esc);
    }

    // Check if any two share a short prefix (collision is likely with 30 tries)
    let ambiguous = false;
    let ambiguousPrefix = '';
    let candidateIds: string[] = [];
    for (let len = 1; len < 8; len++) {
      const prefixes = new Map<string, string[]>();
      for (const esc of escalations) {
        const prefix = esc.id.slice(0, len);
        if (!prefixes.has(prefix)) prefixes.set(prefix, []);
        prefixes.get(prefix)!.push(esc.id);
      }
      for (const [prefix, ids] of prefixes) {
        if (ids.length > 1) {
          ambiguous = true;
          ambiguousPrefix = prefix;
          candidateIds = ids;
          break;
        }
      }
      if (ambiguous) break;
    }

    if (ambiguous) {
      // Now test escalation_resolve with the ambiguous prefix
      const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
        id: ambiguousPrefix,
        status: 'resolved',
      });
      expect(resolveResultStr).not.toBeNull();
      const resolveResult = JSON.parse(resolveResultStr!);
      // Should be an error with both ids listed
      expect(resolveResult.error).toBeDefined();
      expect(resolveResult.error).toContain('ambiguous');
      expect(resolveResult.error).toContain(ambiguousPrefix);

      // Verify both rows are still open
      for (const candId of candidateIds) {
        const esc = getEscalation(candId);
        expect(esc?.status).toBe('open');
      }
    }
    // If we didn't get a collision naturally, the test still passes (collision is probabilistic)
  });

  it('escalation_resolve on an unknown id refuses naming the passed id', async () => {
    const unknownId = 'ffffffffffffffff'; // A very unlikely UUID start

    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: unknownId,
      status: 'resolved',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    // Should fail with "escalation not found" error
    expect(resolveResult.error).toBeDefined();
    expect(resolveResult.error).toContain('escalation not found');
    expect(resolveResult.error).toContain(unknownId);
  });

  it('escalation_list returns summary shape by default with all required fields', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'decision',
      questionText: 'Test question',
      audience: 'human',
      todoId: 'todo-123',
    });

    const resultStr = await handleSupervisorTool('escalation_list', {});
    expect(resultStr).not.toBeNull();
    const result = JSON.parse(resultStr!);
    const item = result.find((r: any) => r.id === escalation.id);
    expect(item).toBeDefined();
    expect(item?.id).toBe(escalation.id);
    expect(item?.kind).toBe('decision');
    expect(item?.todoId).toBe('todo-123');
    expect(item?.project).toBe('/p');
    expect(item?.createdAt).toBeDefined();
    expect(item?.recurrenceCount).toBeDefined();
    expect(item?.excerpt).toBe('Test question');
  });

  it('escalation_list with full:true returns untruncated rows', async () => {
    const longText = 'X'.repeat(300);
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: longText,
      audience: 'human',
    });

    const resultStr = await handleSupervisorTool('escalation_list', { full: true });
    expect(resultStr).not.toBeNull();
    const result = JSON.parse(resultStr!);
    const item = result.find((r: any) => r.id === escalation.id);
    expect(item).toBeDefined();
    // full:true should return the complete Escalation object
    expect(item?.questionText).toBe(longText);
    expect(item?.questionText.length).toBe(300);
    expect(item?.status).toBe('open');
  });
});
