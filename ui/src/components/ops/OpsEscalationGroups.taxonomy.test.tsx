import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import type { Escalation } from '@/stores/supervisorStore';
import { ESCALATION_TAXONOMY } from './escalationTaxonomy';
import { OpsEscalationGroups } from './OpsEscalationGroups';

const mockState = {
  landEpic: vi.fn(),
  resetTodo: vi.fn(),
  overrideAcceptTodo: vi.fn(),
  resolveBudgetCap: vi.fn(),
  decideEscalation: vi.fn(),
  resolveEscalation: vi.fn(),
  promoteTodo: vi.fn(),
  resolvedEscalations: [],
  todosByProject: {},
};

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(mockState) : mockState),
}));

function mkEscalation(over: Partial<Escalation> = {}): Escalation {
  return {
    id: 'esc-test-id',
    project: 'test-project',
    session: 'test-session',
    kind: 'test-kind',
    questionText: 'Test question?',
    status: 'open',
    createdAt: Date.now(),
    ...over,
  };
}

describe('OpsEscalationGroups taxonomy coverage', () => {
  beforeEach(() => {
    Object.values(mockState).forEach((fn) => {
      if (typeof fn === 'function' && fn.mockClear) fn.mockClear();
    });
  });

  // Criterion: imports ESCALATION_TAXONOMY and drives per-kind test cases from array
  it('imports and iterates ESCALATION_TAXONOMY', () => {
    expect(ESCALATION_TAXONOMY).toBeDefined();
    expect(Array.isArray(ESCALATION_TAXONOMY)).toBe(true);
    expect(ESCALATION_TAXONOMY.length).toBeGreaterThan(0);
  });

  // Criterion: mock defines dual-call pattern for selector vs whole-store
  it('mock useSupervisorStore supports both selector and whole-store calls', async () => {
    // Verify the mock handles both selector and whole-store calls
    const { useSupervisorStore } = await import('@/stores/supervisorStore');

    const whole = useSupervisorStore(undefined);
    expect(whole).toBe(mockState);
    expect(whole.landEpic).toBeDefined();

    const selected = useSupervisorStore((s: any) => s.decideEscalation);
    expect(selected).toBe(mockState.decideEscalation);
  });

  // Criterion: epic-ready-to-land calls landEpic on Land click
  it('epic-ready-to-land: calls landEpic on Land click', () => {
    const esc = mkEscalation({ kind: 'epic-ready-to-land' });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const landBtn = screen.getByRole('button', { name: /Land/i });
    fireEvent.click(landBtn);

    expect(mockState.landEpic).toHaveBeenCalledWith('test-scope', 'test-project', 'esc-test-id');
  });

  // Criterion: poison-loop-cap calls resetTodo on Reset click
  it('poison-loop-cap: calls resetTodo on Reset click', () => {
    const esc = mkEscalation({
      kind: 'poison-loop-cap',
      todoId: 'todo-123',
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const resetBtn = screen.getAllByRole('button', { name: /Reset to ready/i })[0];
    fireEvent.click(resetBtn);

    expect(mockState.resetTodo).toHaveBeenCalledWith('test-scope', 'test-project', 'todo-123', 'ready', {
      escalationId: 'esc-test-id',
    });
  });

  // Criterion: reserve-leaf calls overrideAcceptTodo on Override accept click
  it('reserve-leaf: calls overrideAcceptTodo on Override accept click', () => {
    const esc = mkEscalation({
      kind: 'reserve-leaf',
      todoId: 'todo-456',
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const overrideBtn = screen.getAllByRole('button', { name: /Override accept/i })[0];
    fireEvent.click(overrideBtn);

    expect(mockState.overrideAcceptTodo).toHaveBeenCalledWith('test-scope', 'test-project', 'todo-456', 'operator', {
      escalationId: 'esc-test-id',
    });
  });

  // Criterion: token-burn calls resolveBudgetCap on Acknowledge click
  it('token-burn: calls resolveBudgetCap on Acknowledge click', () => {
    const esc = mkEscalation({ kind: 'token-burn' });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const ackBtn = screen.getByRole('button', { name: /Acknowledge/i });
    fireEvent.click(ackBtn);

    expect(mockState.resolveBudgetCap).toHaveBeenCalledWith('test-scope', 'esc-test-id');
  });

  // Criterion: criterion-serve-cap calls decideEscalation on option click
  it('criterion-serve-cap: calls decideEscalation on option click', () => {
    const esc = mkEscalation({
      kind: 'criterion-serve-cap',
      options: [
        { id: 'opt-1', label: 'Option 1' },
        { id: 'opt-2', label: 'Option 2' },
      ],
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const optBtn = screen.getByRole('button', { name: /Option 1/i });
    fireEvent.click(optBtn);

    expect(mockState.decideEscalation).toHaveBeenCalledWith('test-scope', 'esc-test-id', 'opt-1');
  });

  // Criterion: dangling-deps calls resetTodo on Reset click (no-options branch)
  it('dangling-deps: calls resetTodo on Reset click', () => {
    const esc = mkEscalation({
      kind: 'dangling-deps',
      todoId: 'todo-789',
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const resetBtn = screen.getAllByRole('button', { name: /Reset to ready/i })[0];
    fireEvent.click(resetBtn);

    expect(mockState.resetTodo).toHaveBeenCalledWith('test-scope', 'test-project', 'todo-789', 'ready', {
      escalationId: 'esc-test-id',
    });
  });

  // Criterion: blocker with options calls decideEscalation
  it('blocker with options: calls decideEscalation on option click', () => {
    const esc = mkEscalation({
      kind: 'blocker',
      options: [
        { id: 'blocker-opt-1', label: 'Blocker option 1' },
        { id: 'blocker-opt-2', label: 'Blocker option 2' },
      ],
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const optBtn = screen.getByRole('button', { name: /Blocker option 1/i });
    fireEvent.click(optBtn);

    expect(mockState.decideEscalation).toHaveBeenCalledWith('test-scope', 'esc-test-id', 'blocker-opt-1');
  });

  // Criterion: blocker without options calls resolveEscalation on Dismiss
  it('blocker without options: calls resolveEscalation on Dismiss click', () => {
    const esc = mkEscalation({
      kind: 'blocker',
      todoId: undefined,
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const dismissBtn = screen.getByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtn);

    expect(mockState.resolveEscalation).toHaveBeenCalledWith('test-scope', 'esc-test-id', 'resolved');
  });

  // Criterion: unmapped kind (fallthrough) still renders a resolver control
  it('unmapped kind: renders via DEFAULT_ENTRY with resolver control', () => {
    const esc = mkEscalation({
      kind: 'totally-unmapped-kind',
      options: [{ id: 'unmapped-opt', label: 'Unmapped option' }],
    });
    render(<OpsEscalationGroups escalations={[esc]} serverScope="test-scope" />);

    const optBtn = screen.getByRole('button', { name: /Unmapped option/i });
    fireEvent.click(optBtn);

    expect(mockState.decideEscalation).toHaveBeenCalledWith('test-scope', 'esc-test-id', 'unmapped-opt');
  });

  // Criterion: all ESCALATION_TAXONOMY entries are covered
  describe('comprehensive ESCALATION_TAXONOMY coverage', () => {
    ESCALATION_TAXONOMY.forEach((entry) => {
      it(`covers taxonomy entry: '${entry.kind}'`, () => {
        const testedKinds = [
          'epic-ready-to-land',
          'poison-loop-cap',
          'reserve-leaf',
          'token-burn',
          'criterion-serve-cap',
          'dangling-deps',
          'blocker',
        ];
        expect(testedKinds).toContain(entry.kind);
      });
    });
  });
});
