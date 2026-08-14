import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoFileExploreFindings, exploreFindingSignature } from '../explore-finding-filer.js';
import { listTodos, type CreateTodoInput } from '../todo-store.js';
import { ensureBucket } from '../bucket-registry.js';
import { _closeProject as closeTodoProject } from '../todo-store.js';
import { type Finding } from '../finding-store.js';
import { MAX_FINDINGS_PER_REPORT, type AutoActionOutcome, recordAutoAction } from '../auto-action-audit.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'explore-finding-filer-test-'));
});

afterEach(() => {
  closeTodoProject(project);
  rmSync(project, { recursive: true });
});

describe('explore-finding-filer', () => {
  it('files exactly ONE bugfix todo for one finding, with report path, excerpt and fixed-means in the description', async () => {
    // Ensure the bugfix bucket exists.
    const bucketId = await ensureBucket(project, 'bugfix');

    // Create a test finding.
    const finding: Finding = {
      id: 'finding-1',
      todoId: 'todo-1',
      violatedClaim: 'The oracle must be true',
      implicatedFiles: ['src/test.ts', 'src/utils.ts'],
      ruledOut: [],
      reproPath: 'src/test.ts:42',
      failureIdentity: null,
      surface: null,
      sourceLeafId: null,
      recurrenceCount: 1,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    // Create a report with bullet points.
    const reportPath = 'docs/explore/leaf-123.report.md';
    const report = `# Explore Results\n\n- The oracle must be true at src/test.ts:42\n- Another finding here\n`;

    // File the finding.
    const ctx = {
      leaf: { id: 'leaf-123' },
      reportPath,
      report,
      findings: [finding],
    };

    const results = await autoFileExploreFindings(project, ctx);

    // Assert: exactly one result.
    expect(results.length).toBe(1);
    expect(results[0].filed).toBe('created');
    expect(results[0].todoId).toBeDefined();

    // Assert: the todo was created with all required fields.
    const todos = listTodos(project, { includeCompleted: true });
    const sig = exploreFindingSignature(finding);
    const filedTodos = todos.filter((t) => t.frictionSignature === sig);
    expect(filedTodos.length).toBe(1);

    const todo = filedTodos[0];
    expect(todo.parentId).toBe(bucketId);
    expect(todo.status).toBe('planned');
    expect(todo.priority).toBe(2);

    // Assert: description contains all three required fields: report path, excerpt, fixed-means.
    expect(todo.description).toContain(reportPath);
    expect(todo.description).toContain('The oracle must be true at src/test.ts:42');
    expect(todo.description).toContain('Fixed means:');
    expect(todo.description).toContain('must hold');
    expect(todo.description).toContain('no longer reproduces');
  });

  it('re-observing the same finding updates the SAME todo instead of creating a second row', async () => {
    // Ensure the bugfix bucket exists.
    const bucketId = await ensureBucket(project, 'bugfix');

    // Create a test finding.
    const finding: Finding = {
      id: 'finding-1',
      todoId: 'todo-1',
      violatedClaim: 'The oracle must be true',
      implicatedFiles: ['src/test.ts'],
      ruledOut: [],
      reproPath: 'src/test.ts:42',
      failureIdentity: null,
      surface: null,
      sourceLeafId: null,
      recurrenceCount: 1,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const reportPath = 'docs/explore/leaf-123.report.md';
    const report = `# Explore Results\n\n- The oracle must be true at src/test.ts:42\n`;

    const ctx = {
      leaf: { id: 'leaf-123' },
      reportPath,
      report,
      findings: [finding],
    };

    // First filing.
    const results1 = await autoFileExploreFindings(project, ctx);
    expect(results1.length).toBe(1);
    expect(results1[0].filed).toBe('created');
    expect(results1[0].todoId).toBeDefined();
    const todoId1 = results1[0].todoId as string;

    // Second filing with the same finding.
    const results2 = await autoFileExploreFindings(project, ctx);
    expect(results2.length).toBe(1);
    expect(results2[0].filed).toBe('updated');
    expect(results2[0].todoId).toBe(todoId1);

    // Assert: exactly ONE todo with this signature exists (no duplicate).
    const todos = listTodos(project, { includeCompleted: true });
    const sig = exploreFindingSignature(finding);
    const filedTodos = todos.filter((t) => t.frictionSignature === sig);
    expect(filedTodos.length).toBe(1);
    expect(filedTodos[0].id).toBe(todoId1);

    // MUTATION PROBE (documented):
    // Deleting the `findOpenTodoBySignature` branch in autoFileExploreFindings
    // (i.e. always taking the `createTodo` path) makes this test fail with 2 matching todos:
    // - First call creates the first todo.
    // - Second call creates a second todo (no dedup).
    // The test catches this by asserting filedTodos.length === 1.
  });

  it('a call with zero findings writes no todo with an explore: signature', async () => {
    // Ensure the bugfix bucket exists (to rule out bucket non-existence as a side effect).
    await ensureBucket(project, 'bugfix');

    const ctx = {
      leaf: { id: 'leaf-123' },
      reportPath: 'docs/explore/leaf-123.report.md',
      report: `# Explore Results\n\n`,
      findings: [],
    };

    // File zero findings.
    const results = await autoFileExploreFindings(project, ctx);

    // Assert: empty results.
    expect(results.length).toBe(0);

    // Assert: no todos with explore: signature exist.
    const todos = listTodos(project, { includeCompleted: true });
    const exploreTodos = todos.filter((t) => String(t.frictionSignature || '').startsWith('explore:'));
    expect(exploreTodos.length).toBe(0);
  });

  it('caps filings at MAX_FINDINGS_PER_REPORT and records one capped audit row', async () => {
    // Ensure the bugfix bucket exists.
    await ensureBucket(project, 'bugfix');

    // Create MAX_FINDINGS_PER_REPORT + 2 distinct findings.
    const findings: Finding[] = [];
    for (let i = 0; i < MAX_FINDINGS_PER_REPORT + 2; i++) {
      findings.push({
        id: `finding-${i}`,
        todoId: `todo-${i}`,
        violatedClaim: `Claim ${i}`,
        implicatedFiles: [`src/file${i}.ts`],
        ruledOut: [],
        reproPath: `src/file${i}.ts:${i}`,
        failureIdentity: null,
        surface: null,
        sourceLeafId: null,
        recurrenceCount: 1,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
    }

    const reportPath = 'docs/explore/leaf-123.report.md';
    const report = `# Explore Results\n\n${findings.map((f) => `- ${f.violatedClaim}`).join('\n')}\n`;

    // Inject recorder and count calls.
    const auditRows: Array<{ action: string; outcome: AutoActionOutcome; reason: string }> = [];
    const recordAutoActionFn = (input: Parameters<typeof recordAutoAction>[0]) => {
      auditRows.push({
        action: input.action,
        outcome: input.outcome,
        reason: input.reason,
      });
    };

    // Inject createTodo counter.
    let createCount = 0;
    const createTodoFn = async (proj: string, input: CreateTodoInput) => {
      createCount++;
      const result = await listTodos(proj);
      return result[0] || { id: `created-todo-${createCount}` };
    };

    const ctx = {
      leaf: { id: 'leaf-123' },
      reportPath,
      report,
      findings,
    };

    const results = await autoFileExploreFindings(project, ctx, {
      ensureBucket: (proj, type) => ensureBucket(proj, type),
      createTodo: createTodoFn,
      recordAutoAction: recordAutoActionFn,
    });

    // Assert: results array has one entry per input finding.
    expect(results.length).toBe(MAX_FINDINGS_PER_REPORT + 2);

    // Assert: exactly MAX_FINDINGS_PER_REPORT creates.
    expect(createCount).toBe(MAX_FINDINGS_PER_REPORT);

    // Assert: exactly two skipped with per-report-cap refusal.
    const skipped = results.filter((r) => r.filed === 'skipped' && r.refusal === 'per-report-cap');
    expect(skipped.length).toBe(2);

    // Assert: exactly one capped audit row.
    const cappedRows = auditRows.filter((r) => r.outcome === 'capped');
    expect(cappedRows.length).toBe(1);
    expect(cappedRows[0].reason).toContain('per-report-cap:');
    expect(cappedRows[0].reason).toContain(`${MAX_FINDINGS_PER_REPORT + 2}`);
    expect(cappedRows[0].reason).toContain(`MAX_FINDINGS_PER_REPORT ${MAX_FINDINGS_PER_REPORT}`);
    expect(cappedRows[0].reason).toContain(`filed ${MAX_FINDINGS_PER_REPORT}`);
    expect(cappedRows[0].reason).toContain('dropped 2');

    // MUTATION PROBE (documented):
    // Removing the loop bound (slicing at MAX_FINDINGS_PER_REPORT) makes this test fail:
    // - createCount will be MAX_FINDINGS_PER_REPORT + 2 instead of MAX_FINDINGS_PER_REPORT.
    // - The test catches this by asserting createCount === MAX_FINDINGS_PER_REPORT.
  });

  it('a successful filing records one finding-filed/performed audit row naming the signature and report path', async () => {
    // Ensure the bugfix bucket exists.
    await ensureBucket(project, 'bugfix');

    // Create a test finding.
    const finding: Finding = {
      id: 'finding-1',
      todoId: 'todo-1',
      violatedClaim: 'The oracle must be true',
      implicatedFiles: ['src/test.ts', 'src/utils.ts'],
      ruledOut: [],
      reproPath: 'src/test.ts:42',
      failureIdentity: null,
      surface: null,
      sourceLeafId: null,
      recurrenceCount: 1,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    const reportPath = 'docs/explore/leaf-123.report.md';
    const report = `# Explore Results\n\n- The oracle must be true at src/test.ts:42\n`;

    // Inject recorder to capture audit rows.
    const auditRows: Array<{ action: string; outcome: AutoActionOutcome; reason: string }> = [];
    const recordAutoActionFn = (input: Parameters<typeof recordAutoAction>[0]) => {
      auditRows.push({
        action: input.action,
        outcome: input.outcome,
        reason: input.reason,
      });
    };

    const ctx = {
      leaf: { id: 'leaf-123' },
      reportPath,
      report,
      findings: [finding],
    };

    const results = await autoFileExploreFindings(project, ctx, {
      recordAutoAction: recordAutoActionFn,
    });

    // Assert: one successful filing.
    expect(results.length).toBe(1);
    expect(results[0].filed).toBe('created');

    // Assert: exactly one performed audit row.
    const performedRows = auditRows.filter((r) => r.outcome === 'performed');
    expect(performedRows.length).toBe(1);

    // Assert: reason contains the signature and report path.
    const sig = exploreFindingSignature(finding);
    expect(performedRows[0].reason).toContain(sig);
    expect(performedRows[0].reason).toContain(reportPath);
  });
});
