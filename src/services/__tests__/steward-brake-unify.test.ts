import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'steward-brake-unify-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  setSupervisorPause,
  isSupervisorPaused,
  setStewardPause,
  isStewardPaused,
  setStewardEnabled,
  isStewardEnabled,
  isStewardArmed,
  GLOBAL_PAUSE_SCOPE,
  createEscalation,
  _closeDb,
} from '../supervisor-store';
import { mayAutoAnswerEscalation } from '../coordinator-live';
import type { Todo } from '../todo-store';

beforeAll(() => { _closeDb(); });
afterAll(() => {
  _closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_STEWARD_AUTO;
});

function freshDb() {
  _closeDb();
  rmSync(join(dir, 'supervisor.db'), { force: true });
  rmSync(join(dir, 'supervisor.db-wal'), { force: true });
  rmSync(join(dir, 'supervisor.db-shm'), { force: true });
}

describe('A4: Brake unification + kill-switch + operatorGated override', () => {
  beforeEach(() => {
    freshDb();
    delete process.env.MERMAID_STEWARD_AUTO;
  });

  describe('unified brake (setStewardPause ↔ setSupervisorPause)', () => {
    it('setStewardPause(true) sets the global brake visible via isSupervisorPaused()', () => {
      setStewardPause(true);
      expect(isSupervisorPaused()).toBe(true);
      expect(isStewardPaused()).toBe(true);
    });

    it('setSupervisorPause(GLOBAL_PAUSE_SCOPE, true) is visible via isStewardPaused()', () => {
      setSupervisorPause(GLOBAL_PAUSE_SCOPE, true);
      expect(isStewardPaused()).toBe(true);
      expect(isSupervisorPaused()).toBe(true);
    });

    it('setStewardPause(false) clears the global brake', () => {
      setStewardPause(true);
      expect(isStewardPaused()).toBe(true);
      setStewardPause(false);
      expect(isStewardPaused()).toBe(false);
      expect(isSupervisorPaused()).toBe(false);
    });

    it('the brake is ONE shared sentinel — either call site updates it', () => {
      setSupervisorPause(GLOBAL_PAUSE_SCOPE, true);
      expect(isStewardPaused()).toBe(true);
      setStewardPause(false);
      expect(isSupervisorPaused()).toBe(false);
    });
  });

  describe('kill-switch (setStewardEnabled → arm sentinels)', () => {
    beforeEach(() => {
      process.env.MERMAID_STEWARD_AUTO = '1';
    });

    it('setStewardEnabled(false) disarms and is persisted', () => {
      expect(isStewardArmed()).toBe(true); // armed by env default
      setStewardEnabled(false);
      expect(isStewardArmed()).toBe(false);
      expect(isStewardEnabled()).toBe(false);
      // Persists across reopen
      _closeDb();
      expect(isStewardEnabled()).toBe(false);
      expect(isStewardArmed()).toBe(false);
    });

    it('setStewardEnabled(true) re-arms and is persisted', () => {
      setStewardEnabled(false);
      expect(isStewardArmed()).toBe(false);
      setStewardEnabled(true);
      expect(isStewardArmed()).toBe(true);
      expect(isStewardEnabled()).toBe(true);
      // Persists across reopen
      _closeDb();
      expect(isStewardEnabled()).toBe(true);
      expect(isStewardArmed()).toBe(true);
    });

    it('toggling enables/disables independently of the brake', () => {
      setStewardPause(true); // brake on
      expect(isStewardPaused()).toBe(true);
      setStewardEnabled(false); // disarm
      expect(isStewardArmed()).toBe(false);
      expect(isStewardPaused()).toBe(true); // brake unaffected
      setStewardEnabled(true); // re-arm
      expect(isStewardArmed()).toBe(true);
      setStewardPause(false); // brake off
      expect(isStewardPaused()).toBe(false);
    });
  });

  describe('operatorGated override in mayAutoAnswerEscalation', () => {
    it('returns false when esc.operatorGated is 1 (the override)', () => {
      const project = '/test';
      const todos: Todo[] = [];
      const esc = createEscalation({
        project,
        session: 's1',
        kind: 'blocker',
        questionText: 'q1',
        todoId: 'todo1',
        operatorGated: true,
      }).escalation;

      expect(mayAutoAnswerEscalation(project, esc, todos)).toBe(false);
    });

    it('returns false when todoId is null', () => {
      const project = '/test';
      const todos: Todo[] = [];
      const esc = createEscalation({
        project,
        session: 's1',
        kind: 'blocker',
        questionText: 'q2',
        operatorGated: false,
      }).escalation;

      expect(mayAutoAnswerEscalation(project, esc, todos)).toBe(false);
    });

    it('returns false when todo chain does not resolve to a mission epic (empty todos)', () => {
      const project = '/test';
      const todos: Todo[] = [];

      const esc = createEscalation({
        project,
        session: 's1',
        kind: 'blocker',
        questionText: 'q3',
        todoId: 'todo1',
        operatorGated: false,
      }).escalation;

      // Without a real mission epic, should return false (todoId not found in todos)
      expect(mayAutoAnswerEscalation(project, esc, todos)).toBe(false);
    });

    it('operatorGated: 1 blocks auto-answer even when todoId is set', () => {
      const project = '/test';
      const todos: Todo[] = [];

      const esc = createEscalation({
        project,
        session: 's1',
        kind: 'blocker',
        questionText: 'operator-gated-mission',
        todoId: 'todo1',
        operatorGated: true,
      }).escalation;

      expect(esc.operatorGated).toBe(1);
      // operatorGated: 1 should always return false
      expect(mayAutoAnswerEscalation(project, esc, todos)).toBe(false);
    });

    it('operatorGated: 0 with null todoId returns false', () => {
      const project = '/test';
      const todos: Todo[] = [];

      const esc = createEscalation({
        project,
        session: 's1',
        kind: 'blocker',
        questionText: 'no-todo-id',
        operatorGated: false,
      }).escalation;

      expect(esc.operatorGated).toBe(0);
      expect(esc.todoId).toBe(null);
      expect(mayAutoAnswerEscalation(project, esc, todos)).toBe(false);
    });
  });
});
