import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

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
    // Insert two escalations with a shared 8-char prefix
    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);

    const id1 = 'bbbbbbbb-0000-0000-0000-000000000001';
    const id2 = 'bbbbbbbb-0000-0000-0000-000000000002';
    const prefix = 'bbbbbbbb';
    const now = Date.now();

    directDb.prepare(
      'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, audience) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id1, '/p', 'ambig-sess', 'test', 'test question 1', 'open', now, 'human');
    directDb.prepare(
      'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, audience) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id2, '/p', 'ambig-sess', 'test', 'test question 2', 'open', now, 'human');

    directDb.close();

    // Try to resolve with the ambiguous prefix
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: prefix,
      status: 'resolved',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    // Should be an error with ambiguous and the prefix
    expect(resolveResult.error).toBeDefined();
    expect(resolveResult.error).toContain('ambiguous');
    expect(resolveResult.error).toContain(prefix);

    // Verify both rows are still open
    const esc1 = getEscalation(id1);
    expect(esc1?.status).toBe('open');
    const esc2 = getEscalation(id2);
    expect(esc2?.status).toBe('open');
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

  it('escalation_resolve never answers success:true unless the re-read status matches what was written', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'Verification test',
      audience: 'human',
    });

    // Resolve via the tool
    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: escalation.id,
      status: 'resolved',
      note: 'Test note',
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);
    expect(resolveResult.success).toBe(true);
    expect(resolveResult.status).toBe('resolved');

    // Verify with a fresh read
    const freshRead = getEscalation(escalation.id);
    expect(freshRead).not.toBeNull();
    expect(freshRead!.status).toBe('resolved');
    expect(resolveResult.status).toBe(freshRead!.status);
  });

  it('escalation_resolve on the resolve branch refuses success when a post-write re-read diverges', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'Divergence test',
      audience: 'human',
    });

    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);

    try {
      const triggerId = `divert_resolve_1`;
      directDb.prepare(
        `CREATE TRIGGER ${triggerId} AFTER UPDATE ON escalation WHEN NEW.id='${escalation.id}' AND NEW.status<>'obsolete' BEGIN UPDATE escalation SET status='obsolete' WHERE id=NEW.id; END;`
      ).run();

      const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
        id: escalation.id,
        status: 'resolved',
        note: 'n',
      });
      expect(resolveResultStr).not.toBeNull();
      const resolveResult = JSON.parse(resolveResultStr!);

      expect(resolveResult.error).toBeDefined();
      expect(resolveResult.error).toContain('did not verify');
      expect(resolveResult.error).toContain('expected status "resolved"');
      expect(resolveResult.error).toContain('observed "obsolete"');
      expect(resolveResult.success).not.toBe(true);
    } finally {
      directDb.prepare('DROP TRIGGER IF EXISTS divert_resolve_1').run();
      directDb.close();
    }
  });

  it('escalation_resolve on the acknowledged branch refuses success when the row vanishes after write', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'Vanish test',
      audience: 'human',
    });

    const dbPath = join(dir, 'supervisor.db');
    const directDb = new Database(dbPath);

    try {
      const triggerId = `divert_resolve_2`;
      directDb.prepare(
        `CREATE TRIGGER ${triggerId} AFTER UPDATE ON escalation WHEN NEW.id='${escalation.id}' AND NEW.status='acknowledged' BEGIN DELETE FROM escalation WHERE id=NEW.id; END;`
      ).run();

      const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
        id: escalation.id,
        status: 'acknowledged',
      });
      expect(resolveResultStr).not.toBeNull();
      const resolveResult = JSON.parse(resolveResultStr!);

      expect(resolveResult.error).toBeDefined();
      expect(resolveResult.error).toContain('did not verify');
      expect(resolveResult.error).toContain('expected status "acknowledged"');
      expect(resolveResult.error).toContain('observed no row');
      expect(resolveResult.success).not.toBe(true);
    } finally {
      directDb.prepare('DROP TRIGGER IF EXISTS divert_resolve_2').run();
      directDb.close();
    }
  });

  it('escalation_resolve happy path returns the re-read normalized status and note, not the caller-supplied strings', async () => {
    const { escalation } = createEscalation({
      project: '/p',
      session: 's',
      kind: 'question',
      questionText: 'Happy path test',
      audience: 'human',
    });

    const resolveResultStr = await handleSupervisorTool('escalation_resolve', {
      id: escalation.id,
      status: 'resolved - all set',
      note: undefined,
    });
    expect(resolveResultStr).not.toBeNull();
    const resolveResult = JSON.parse(resolveResultStr!);

    expect(resolveResult.success).toBe(true);
    expect(resolveResult.status).toBe('resolved');
    expect(resolveResult.note).toBe('all set');
  });
});
