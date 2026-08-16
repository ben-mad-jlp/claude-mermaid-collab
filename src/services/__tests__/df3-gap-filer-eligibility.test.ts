// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction } from '../friction-store';
import { _closeProject as closeFrictionProject } from '../friction-store';
import { runFrictionTriagePass, sweepStaleAutoFiledGaps } from '../friction-triage';
import { listTodos, createTodo, getTodo, updateTodo, _closeProject as closeTodoProject } from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'df3-gap-filer-'));
});

afterEach(() => {
  closeFrictionProject(project);
  closeTodoProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('df3-gap-filer-eligibility', () => {
  it('a success-signal reason files zero gaps at recurrence 5', async () => {
    // Record 5 friction notes with a success-signal reason (quarantine-deflaked)
    for (let i = 0; i < 5; i++) {
      await recordFriction(project, {
        layer: 'orchestration',
        retryReason: 'quarantine-deflaked',
        detail: `note ${i}`,
      });
    }

    // Run the friction triage pass with threshold: 3
    const result = await runFrictionTriagePass(project, { threshold: 3 });

    // Assert no gaps were filed (success-signal is filtered out)
    expect(result.filed).toBe(0);

    // Assert no non-bucket todos were created
    const todos = listTodos(project);
    const nonBucketTodos = todos.filter((t) => !t.isBucket && !t.bucketType);
    expect(nonBucketTodos.length).toBe(0);
  });

  it('a defect reason files exactly one deduped gap', async () => {
    // Record 3 notes with a defect reason (not a success-signal)
    for (let i = 0; i < 3; i++) {
      await recordFriction(project, {
        layer: 'domain',
        retryReason: 'missing-domain-model',
        detail: `domain note ${i}`,
      });
    }

    // First pass: should file 1 gap
    const result1 = await runFrictionTriagePass(project, { threshold: 3 });
    expect(result1.filed).toBe(1);

    // Second pass: should file 0 (already actioned marker)
    const result2 = await runFrictionTriagePass(project, { threshold: 3 });
    expect(result2.filed).toBe(0);

    // Assert exactly one todo with the reason in the title
    const todos = listTodos(project);
    const defectTodos = todos.filter((t) => t.title.includes('missing-domain-model'));
    expect(defectTodos.length).toBe(1);

    // Assert the triage tag is 'domain'
    expect(defectTodos[0].triageTag).toBe('domain');
  });

  it('a stale auto-filed gap is closed by the sweep', async () => {
    // Record 3 notes for a defect reason
    for (let i = 0; i < 3; i++) {
      await recordFriction(project, {
        layer: 'orchestration',
        retryReason: 'missing-orchestration-handler',
        detail: `orch note ${i}`,
      });
    }

    // Run the pass to file a gap
    const result = await runFrictionTriagePass(project, { threshold: 3 });
    expect(result.filed).toBe(1);

    // Get the filed todo id
    const todos = listTodos(project);
    const filedTodo = todos.find((t) => t.title.includes('missing-orchestration-handler'));
    expect(filedTodo).toBeDefined();
    const todoId = filedTodo!.id;

    // Run the sweep with no new notes recorded
    const sweepResult = await sweepStaleAutoFiledGaps(project);
    expect(sweepResult.swept).toBe(1);

    // Assert the todo is now done
    const updatedTodo = getTodo(project, todoId);
    expect(updatedTodo?.status).toBe('done');
  });

  it('auto-filed rows carry a provenance field', async () => {
    // Record 3 notes to trigger auto-filing
    for (let i = 0; i < 3; i++) {
      await recordFriction(project, {
        layer: 'domain',
        retryReason: 'broken-type-check',
        detail: `type ${i}`,
      });
    }

    // Run the pass to auto-file
    const result = await runFrictionTriagePass(project, { threshold: 3 });
    expect(result.filed).toBe(1);

    // Get the auto-filed todo
    const todos = listTodos(project);
    const autoFiledTodo = todos.find((t) => t.title.includes('broken-type-check'));
    expect(autoFiledTodo).toBeDefined();
    expect(autoFiledTodo!.filingProvenance).toBe('auto:df3-gap-filer');

    // Get the bugfix bucket
    const bucketTodo = todos.find((t) => t.isBucket && t.bucketType === 'bugfix');
    expect(bucketTodo).toBeDefined();

    // Create a hand-filed sibling under the bucket
    const handFiled = await createTodo(project, {
      ownerSession: 'manual-session',
      parentId: bucketTodo!.id,
      title: 'Hand-filed sibling',
      status: 'todo',
    });

    // Assert the hand-filed todo has no filing provenance
    expect(handFiled.filingProvenance).toBeNull();
  });
});
