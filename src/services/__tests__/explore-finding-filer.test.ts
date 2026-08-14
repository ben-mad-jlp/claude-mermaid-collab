import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { autoFileExploreFindings, exploreFindingSignature } from '../explore-finding-filer.js';
import { listTodos } from '../todo-store.js';
import { ensureBucket } from '../bucket-registry.js';
import { _closeProject as closeTodoProject } from '../todo-store.js';
import { type Finding } from '../finding-store.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join('/var/folders/df/46_3zwkn7vb9p8sv93r1qqz40000gn/T', 'explore-finding-filer-test-'));
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
});
