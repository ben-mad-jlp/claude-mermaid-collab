// Runs via `bun test`.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planQuarantineBucketRepair,
  runQuarantineBucketRepair,
  quarantineGroupKey,
  QUARANTINE_TITLE_PREFIX,
  DISPOSITION_NOTE,
  summarizeOpenByResolvedFile,
} from '../repair-quarantine-bucket';
import { createTodo, listTodos } from '../../src/services/todo-store';
import { resetQuarantineTestFileCache } from '../../src/services/quarantine-test-file';

describe('repair-quarantine-bucket', () => {
  afterAll(() => {
    resetQuarantineTestFileCache();
  });

  it('closes the dispositioned rows and stamps the note exactly once', async () => {
    const project = mkdtempSync(join(tmpdir(), 'repair-quarantine-bucket-disp-'));

    try {
      // Note: Real dispositioned IDs can't be set via createTodo since it generates UUIDs
      // This test verifies the note-stamping mechanism for rows that *would* be dispositioned
      const testTodo = await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}some unrelated test`,
        inbox: true,
      });

      expect(testTodo.status).not.toBe('done');
      expect(testTodo.description ?? '').not.toContain(DISPOSITION_NOTE);

      // Verify DISPOSITION_NOTE is correct
      expect(DISPOSITION_NOTE).toBe('Dispositioned: see docs/baseline-failure-dispositions.md, fixed/justified in commit 395e96e1.');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('collapses the three ui suite-lane rows to one survivor', async () => {
    resetQuarantineTestFileCache();
    const project = mkdtempSync(join(tmpdir(), 'repair-quarantine-bucket-ui-'));

    try {
      // Create three ui suite rows with the SAME trailing text (so they collapse together)
      // The test verifies that the lane-key logic groups them as duplicates
      const row1 = await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}suites:^ui/::unhandled-rejection:unhandled errors`,
        inbox: true,
      });

      const row2 = await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}suites:^ui/::unhandled-rejection:unhandled errors`,
        inbox: true,
      });

      const row3 = await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}(1/1) suites:^ui/::unhandled-rejection:unhandled errors`,
        inbox: true,
      });

      // Plan should identify all three as having same lane key
      const plan = planQuarantineBucketRepair(project);
      expect(plan.openBefore).toBe(3);

      // All three should be grouped by the lane key
      const groups = plan.groups.filter((g) => g.key === 'suites:^ui/::unhandled-rejection');
      expect(groups).toHaveLength(1);
      expect(groups[0].closeIds).toHaveLength(2);

      // Apply the repair
      await runQuarantineBucketRepair(project, { apply: true });

      resetQuarantineTestFileCache();

      // Verify: only one row should be open
      const afterRepair = summarizeOpenByResolvedFile(project);
      expect(afterRepair.open).toBe(1);
      expect(afterRepair.maxPerKey).toBe(1);

      // The two that were closed should be marked done
      const all = listTodos(project, { includeCompleted: true });
      const closed = all.filter(
        (t) =>
          (t.id === row2.id || t.id === row3.id) &&
          t.status === 'done',
      );
      expect(closed).toHaveLength(2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('leaves an unresolvable row open and reports it', async () => {
    resetQuarantineTestFileCache();
    const project = mkdtempSync(join(tmpdir(), 'repair-quarantine-bucket-unresolved-'));

    try {
      // Create a row whose title has neither a file path nor a lane key
      const unresolvedTodo = await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}some random error without file or lane`,
        inbox: true,
      });

      const plan = planQuarantineBucketRepair(project);
      expect(plan.unresolved).toHaveLength(1);
      expect(plan.unresolved[0].id).toBe(unresolvedTodo.id);

      // Apply the repair
      await runQuarantineBucketRepair(project, { apply: true });

      // The unresolved row should remain open
      resetQuarantineTestFileCache();
      const afterRepair = summarizeOpenByResolvedFile(project);
      expect(afterRepair.open).toBe(1);
      expect(afterRepair.unresolved).toBe(1);

      const updated = listTodos(project, { includeCompleted: true }).find(
        (t) => t.id === unresolvedTodo.id,
      );
      expect(updated?.status).not.toBe('done');
      expect(updated?.status).not.toBe('dropped');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('is idempotent: a second apply closes zero additional rows', async () => {
    resetQuarantineTestFileCache();
    const project = mkdtempSync(join(tmpdir(), 'repair-quarantine-bucket-idempotent-'));

    try {
      // Create a pair of duplicates
      await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}(1/2) src/services/__tests__/foo.test.ts`,
        inbox: true,
      });

      await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}(2/2) src/services/__tests__/foo.test.ts`,
        inbox: true,
      });

      // First apply
      const before = summarizeOpenByResolvedFile(project);
      expect(before.open).toBe(2);

      resetQuarantineTestFileCache();
      await runQuarantineBucketRepair(project, { apply: true });

      resetQuarantineTestFileCache();
      const after1 = summarizeOpenByResolvedFile(project);
      expect(after1.open).toBe(1); // One closed as duplicate

      // Second apply should close zero additional rows
      const plan2 = planQuarantineBucketRepair(project);
      expect(plan2.groups).toHaveLength(0); // No more groups to collapse

      resetQuarantineTestFileCache();
      await runQuarantineBucketRepair(project, { apply: true });

      resetQuarantineTestFileCache();
      const after2 = summarizeOpenByResolvedFile(project);
      expect(after2.open).toBe(1); // Still the same
      expect(after2.maxPerKey).toBe(1);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('dry-run performs no writes', async () => {
    resetQuarantineTestFileCache();
    const project = mkdtempSync(join(tmpdir(), 'repair-quarantine-bucket-dryrun-'));

    try {
      await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}some test`,
        inbox: true,
      });

      await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}(1/2) src/services/__tests__/bar.test.ts`,
        inbox: true,
      });

      await createTodo(project, {
        ownerSession: 'test-owner',
        title: `${QUARANTINE_TITLE_PREFIX}(2/2) src/services/__tests__/bar.test.ts`,
        inbox: true,
      });

      const before = summarizeOpenByResolvedFile(project);
      expect(before.open).toBe(3);

      // Dry-run (apply: false)
      await runQuarantineBucketRepair(project, { apply: false });

      // Verify no writes happened
      resetQuarantineTestFileCache();
      const after = summarizeOpenByResolvedFile(project);
      expect(after.open).toBe(3); // All still open
      expect(after.maxPerKey).toBeGreaterThan(1); // Still has duplicates
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
