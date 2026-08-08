import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  recordFinding,
  getFinding,
  getFindingByTodoId,
  listFindings,
  findByFailureIdentity,
  bumpRecurrence,
  _closeProject,
} from '../finding-store';

describe('finding-store', () => {
  const testProjectDir = join(import.meta.dir, '../../..', '.test-findings-store');

  afterEach(() => {
    _closeProject(testProjectDir);
    try {
      rmSync(testProjectDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('round-trips implicatedFiles and ruledOut as arrays', async () => {
    const input = {
      todoId: 'todo-1',
      violatedClaim: 'test must not crash',
      implicatedFiles: ['src/app.ts', 'src/utils.ts'],
      ruledOut: ['src/test.ts'],
      reproPath: '__quarantine__/crash-test.ts',
      failureIdentity: 'ReferenceError: x is not defined',
    };

    const recorded = await recordFinding(testProjectDir, input);
    const retrieved = await getFinding(testProjectDir, recorded.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.implicatedFiles).toEqual(['src/app.ts', 'src/utils.ts']);
    expect(retrieved!.implicatedFiles[0]).toBe('src/app.ts');
    expect(retrieved!.implicatedFiles[1]).toBe('src/utils.ts');
    expect(retrieved!.ruledOut).toEqual(['src/test.ts']);
    expect(retrieved!.ruledOut[0]).toBe('src/test.ts');
  });

  it('bumpRecurrence increments recurrenceCount without adding a row', async () => {
    const input = {
      todoId: 'todo-2',
      violatedClaim: 'test must pass',
      reproPath: '__quarantine__/flake-test.ts',
    };

    const recorded = await recordFinding(testProjectDir, input);
    expect(recorded.recurrenceCount).toBe(1);

    const now = new Date().toISOString();
    const bumped = await bumpRecurrence(testProjectDir, recorded.id, now);
    expect(bumped.recurrenceCount).toBe(2);

    const all = await listFindings(testProjectDir);
    expect(all.length).toBe(1);
    expect(all[0].recurrenceCount).toBe(2);
  });

  it('records and retrieves findings with all fields', async () => {
    const input = {
      todoId: 'todo-3',
      violatedClaim: 'performance must be acceptable',
      implicatedFiles: ['src/slow.ts'],
      ruledOut: ['src/fast.ts', 'src/cached.ts'],
      reproPath: '__quarantine__/perf-test.ts',
      failureIdentity: 'timeout after 5s',
      surface: 'API endpoint /users',
    };

    const recorded = await recordFinding(testProjectDir, input);
    expect(recorded.id).toBeDefined();
    expect(recorded.todoId).toBe(input.todoId);
    expect(recorded.violatedClaim).toBe(input.violatedClaim);
    expect(recorded.reproPath).toBe(input.reproPath);
    expect(recorded.failureIdentity).toBe(input.failureIdentity);
    expect(recorded.surface).toBe(input.surface);
    expect(recorded.recurrenceCount).toBe(1);
    expect(recorded.createdAt).toBeDefined();
    expect(recorded.lastSeenAt).toBeDefined();
  });

  it('getFindingByTodoId retrieves by todoId', async () => {
    const todoId = 'todo-unique';
    await recordFinding(testProjectDir, {
      todoId,
      violatedClaim: 'must not crash',
      reproPath: '__quarantine__/test.ts',
    });

    const found = await getFindingByTodoId(testProjectDir, todoId);
    expect(found).not.toBeNull();
    expect(found!.todoId).toBe(todoId);
  });

  it('findByFailureIdentity finds all with matching identity', async () => {
    const identity = 'SyntaxError: unexpected token';

    await recordFinding(testProjectDir, {
      todoId: 'todo-a',
      violatedClaim: 'must compile',
      reproPath: '__quarantine__/a.ts',
      failureIdentity: identity,
    });

    await recordFinding(testProjectDir, {
      todoId: 'todo-b',
      violatedClaim: 'must compile',
      reproPath: '__quarantine__/b.ts',
      failureIdentity: identity,
    });

    await recordFinding(testProjectDir, {
      todoId: 'todo-c',
      violatedClaim: 'must compile',
      reproPath: '__quarantine__/c.ts',
      failureIdentity: 'different identity',
    });

    const matches = await findByFailureIdentity(testProjectDir, identity);
    expect(matches.length).toBe(2);
    expect(matches.some((f) => f.todoId === 'todo-a')).toBe(true);
    expect(matches.some((f) => f.todoId === 'todo-b')).toBe(true);
  });

  it('validates required fields', async () => {
    let threw = false;
    try {
      await recordFinding(testProjectDir, {
        todoId: '',
        violatedClaim: 'test',
        reproPath: 'test.ts',
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('todoId is required');
    }
    expect(threw).toBe(true);

    threw = false;
    try {
      await recordFinding(testProjectDir, {
        todoId: 'todo',
        violatedClaim: '',
        reproPath: 'test.ts',
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('violatedClaim is required');
    }
    expect(threw).toBe(true);

    threw = false;
    try {
      await recordFinding(testProjectDir, {
        todoId: 'todo',
        violatedClaim: 'test',
        reproPath: '',
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('reproPath is required');
    }
    expect(threw).toBe(true);
  });

  it('bumpRecurrence throws for nonexistent id', async () => {
    let threw = false;
    try {
      await bumpRecurrence(testProjectDir, 'nonexistent-id', new Date().toISOString());
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('no finding with id');
    }
    expect(threw).toBe(true);
  });

  it('listFindings returns empty array for empty database', async () => {
    const findings = await listFindings(testProjectDir);
    expect(findings.length).toBe(0);
  });

  it('handles arrays with various content', async () => {
    const input = {
      todoId: 'todo-4',
      violatedClaim: 'test',
      implicatedFiles: ['a.ts', 'b/c.ts', 'd/e/f.ts'],
      ruledOut: ['x.ts'],
      reproPath: '__quarantine__/test.ts',
    };

    const recorded = await recordFinding(testProjectDir, input);
    const retrieved = await getFinding(testProjectDir, recorded.id);

    expect(retrieved!.implicatedFiles).toEqual(['a.ts', 'b/c.ts', 'd/e/f.ts']);
    expect(retrieved!.ruledOut).toEqual(['x.ts']);
  });
});
