import { describe, test, expect } from 'bun:test';
import { getTodo, createTodo, _closeProject } from '../todo-store';
import { readBugfixSpec } from '../bugfix-spec';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let project: string;

function setup() {
  project = mkdtempSync(join(tmpdir(), 'bugfix-spec-test-'));
}

function teardown() {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
}

describe('bugfix-spec module', () => {
  test('file_bugfix with a custom description still round-trips fixedMeans character-identical', async () => {
    setup();
    try {
      const observedFailure = 'Test failure observed';
      const evidence = '/path/to/test.ts:42';
      const fixedMeans = 'Changed X from A to B to fix the issue';
      const customDescription = 'This is a custom user description that differs from the spec';

      // File via workgraph tool (simulated: we create directly with bugfixSpec)
      const created = await createTodo(project, {
        kind: 'leaf',
        title: 'Test bugfix',
        ownerSession: 'test-session',
        parentId: (await createTodo(project, {
          kind: 'epic',
          title: 'Bugfix inbox',
          ownerSession: 'test-session',
          isBucket: true,
        })).id,
        description: customDescription,
        bugfixSpec: { observedFailure, evidence, fixedMeans },
      });

      // Re-read from store
      const retrieved = getTodo(project, created.id);
      expect(retrieved).toBeTruthy();

      // Assert round-trip: fixedMeans is character-identical
      const spec = readBugfixSpec(retrieved!);
      expect(spec).toBeTruthy();
      expect(spec!.fixedMeans).toBe(fixedMeans);
    } finally {
      teardown();
    }
  });

  test('a legacy Failure/Evidence/Fixed description parses back to the three fields', async () => {
    setup();
    try {
      const observedFailure = 'Something broke in the pipeline';
      const evidence = 'logs at /tmp/error.log:123-456';
      const fixedMeans = 'Added bounds check before array access';

      // Legacy format: created with only the prose block, no bugfixSpec
      const created = await createTodo(project, {
        kind: 'leaf',
        title: 'Legacy bugfix',
        ownerSession: 'test-session',
        parentId: (await createTodo(project, {
          kind: 'epic',
          title: 'Bugfix inbox',
          ownerSession: 'test-session',
          isBucket: true,
        })).id,
        description: `Failure: ${observedFailure}\nEvidence: ${evidence}\nFixed: ${fixedMeans}`,
      });

      // Re-read from store
      const retrieved = getTodo(project, created.id);
      expect(retrieved).toBeTruthy();

      // Parse the legacy block
      const spec = readBugfixSpec(retrieved!);
      expect(spec).toBeTruthy();
      expect(spec!.observedFailure).toBe(observedFailure);
      expect(spec!.evidence).toBe(evidence);
      expect(spec!.fixedMeans).toBe(fixedMeans);
    } finally {
      teardown();
    }
  });

  test('a todo with neither a stored spec nor a legacy block reads null', async () => {
    setup();
    try {
      // Create with just a description that isn't legacy format
      const created = await createTodo(project, {
        kind: 'leaf',
        title: 'No spec todo',
        ownerSession: 'test-session',
        parentId: (await createTodo(project, {
          kind: 'epic',
          title: 'Bugfix inbox',
          ownerSession: 'test-session',
          isBucket: true,
        })).id,
        description: 'Just a plain description with no Failure: block',
      });

      // Re-read from store
      const retrieved = getTodo(project, created.id);
      expect(retrieved).toBeTruthy();

      // Should read null
      const spec = readBugfixSpec(retrieved!);
      expect(spec).toBeNull();
    } finally {
      teardown();
    }
  });
});
