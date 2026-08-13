import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, findOpenTodoBySignature, updateTodo, getTodo, _closeProject } from '../todo-store';

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    _closeProject(tempDir);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('frictionSignature lookup', () => {
  test('returns the open todo when a dropped row shares the signature', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'friction-sig-test-'));

    const dropped = await createTodo(tempDir, {
      ownerSession: 'test-session',
      title: 'Dropped friction item',
      kind: 'epic',
      frictionSignature: 'test-signature-123',
    });

    const open = await createTodo(tempDir, {
      ownerSession: 'test-session',
      title: 'Open friction item',
      kind: 'epic',
      frictionSignature: 'test-signature-123',
    });

    await updateTodo(tempDir, dropped.id, { status: 'dropped' });

    const found = findOpenTodoBySignature(tempDir, 'test-signature-123');

    expect(found).not.toBeNull();
    expect(found?.id).toBe(open.id);
    expect(found?.status).toBe('todo');
  });

  test('returns null for an unknown signature', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'friction-sig-test-'));

    const found = findOpenTodoBySignature(tempDir, 'unknown-signature');

    expect(found).toBeNull();
  });
});
