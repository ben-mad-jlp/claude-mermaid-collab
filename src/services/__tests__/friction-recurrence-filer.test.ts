import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { recordFrictionTool } from '../../mcp/tools/friction.js';
import { listTodos } from '../todo-store.js';
import { ensureBucket } from '../bucket-registry.js';
import { _closeProject as closeFrictionProject } from '../friction-store.js';
import { _closeProject as closeTodoProject } from '../todo-store.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join('/var/folders/df/46_3zwkn7vb9p8sv93r1qqz40000gn/T', 'friction-recurrence-filer-test-'));
});

afterEach(() => {
  closeFrictionProject(project);
  closeTodoProject(project);
  rmSync(project, { recursive: true });
});

describe('friction-recurrence-filer: integration via tool surface', () => {
  it('files exactly ONE deduplicated bugfix todo at the 3rd of 5 same-signature notes', async () => {
    // Ensure the bugfix bucket exists for assertion (a).
    const bucketId = await ensureBucket(project, 'bugfix');

    // Drive 5 identical calls through recordFrictionTool.
    // All have the same layer, retryReason, detail → same signature.
    interface CallResult { success: true; signature: string; priorCount: number; priorNoteIds: string[]; note: { id: string } }
    const callResults: CallResult[] = [];
    const snapshotsByCall: Array<ReturnType<typeof listTodos>> = [];

    for (let i = 0; i < 5; i++) {
      const result = await recordFrictionTool({
        project,
        layer: 'orchestration',
        retryReason: 'gate-format',
        detail: 'gate output format wrong',
      });
      callResults.push(result);
      const snapshot = listTodos(project, { includeCompleted: true });
      snapshotsByCall.push(snapshot);
    }

    const sig = callResults[0].signature;

    // ASSERTION (a): After all 5 calls, exactly ONE todo has this signature and is parented to the bugfix bucket.
    const afterAll5 = snapshotsByCall[4];
    const matchingTodos = afterAll5.filter((t) => t.frictionSignature === sig);
    expect(matchingTodos.length).toBe(1);
    expect(matchingTodos[0].parentId).toBe(bucketId);
    const filedTodoId = matchingTodos[0].id;

    // ASSERTION (b): The todo did NOT exist after calls 1 and 2, but DID exist after call 3.
    const after1 = snapshotsByCall[0];
    const existing1 = after1.find((t) => t.frictionSignature === sig);
    expect(existing1).toBeUndefined();

    const after2 = snapshotsByCall[1];
    const existing2 = after2.find((t) => t.frictionSignature === sig);
    expect(existing2).toBeUndefined();

    const after3 = snapshotsByCall[2];
    const existing3 = after3.find((t) => t.frictionSignature === sig);
    expect(existing3).toBeDefined();
    expect(existing3!.id).toBe(filedTodoId); // same todo from call 3 onward

    // ASSERTION (c): The description contains "Occurrences: 5" and all 5 note ids.
    const finalTodo = afterAll5.find((t) => t.id === filedTodoId);
    expect(finalTodo).toBeDefined();
    expect(finalTodo!.description).toContain('Occurrences: 5');

    // Build the expected note ids list: the ids that should be in the description after call 5.
    // After call N, priorNoteIds contains the ids of notes 1..N-1, and the current note id is in note.id.
    // So the description should list: priorNoteIds from call 5 + note id from call 5.
    const expectedNoteIds = callResults[4].priorNoteIds.concat(callResults[4].note.id);
    for (const nid of expectedNoteIds) {
      expect(finalTodo!.description).toContain(nid);
    }

    // MUTATION PROBE (documented in the test):
    // Deleting the `findOpenTodoBySignature` dedup guard in autoFileRecurringFriction
    // (i.e. always taking the `createTodo` branch) makes assertion (a) fail with 3 matching todos:
    // - Call 3 creates the first todo.
    // - Call 4 creates a second todo (no dedup).
    // - Call 5 creates a third todo (no dedup).
    // The test catches this by asserting matchingTodos.length === 1.
  });
});
