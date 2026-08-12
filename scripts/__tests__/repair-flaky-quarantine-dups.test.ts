// Runs via `bun test`.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countOpenQuarantineDupKeys,
  QUARANTINE_TITLE_PREFIX,
} from '../repair-flaky-quarantine-dups.ts';
import { collapseQuarantineDuplicates } from '../../src/services/quarantine-dedup';
import { createTodo } from '../../src/services/todo-store';

describe('repair-flaky-quarantine-dups', () => {
  const project = mkdtempSync(join(tmpdir(), 'repair-flaky-dedup-'));

  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('flags a seeded duplicate pair before repair and clears it after collapseQuarantineDuplicates', async () => {
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
    await createTodo(project, {
      ownerSession: 'test-owner',
      title: `${QUARANTINE_TITLE_PREFIX}src/services/__tests__/bar.test.ts`,
      inbox: true,
    });

    const before = countOpenQuarantineDupKeys(project);
    const seededKey = before.dupKeys.find(
      (d) => d.key === 'src/services/__tests__/foo.test.ts',
    );
    expect(seededKey).toBeDefined();
    expect(seededKey?.count).toBe(2);
    const beforeTotal = before.total;

    await collapseQuarantineDuplicates(project);

    const after = countOpenQuarantineDupKeys(project);
    expect(after.dupKeys.length).toBe(0);
    expect(after.total).toBe(beforeTotal - 1);
  });
});
