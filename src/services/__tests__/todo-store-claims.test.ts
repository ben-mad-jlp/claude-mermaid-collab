import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { claimTodo, createTodo, getTodo, PROCESS_CLAIM_EPOCH, _closeProject } from '../todo-store.js';

describe('claimTodo stamps a non-empty epoch', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'todo-store-claims-'));
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  test('claimTodo without an epoch argument still writes a non-empty epoch in the claim JSON', async () => {
    const todo = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'test',
      status: 'ready',
    });

    // Claim without passing an epoch argument — should default to PROCESS_CLAIM_EPOCH
    const claimed = await claimTodo(project, todo.id, 'agent-1', 60_000);
    expect(claimed).not.toBeNull();
    expect(claimed!.claim).not.toBeNull();
    expect(typeof claimed!.claim!.epoch).toBe('string');
    expect(claimed!.claim!.epoch!.length).toBeGreaterThan(0);
  });

  test('an explicitly passed epoch is stored verbatim', async () => {
    const explicitEpoch = 'coordinator-epoch-123';
    const todo = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'test',
      status: 'ready',
    });

    const claimed = await claimTodo(project, todo.id, 'agent-1', 60_000, explicitEpoch);
    expect(claimed).not.toBeNull();
    expect(claimed!.claim).not.toBeNull();
    expect(claimed!.claim!.epoch).toBe(explicitEpoch);
  });
});
