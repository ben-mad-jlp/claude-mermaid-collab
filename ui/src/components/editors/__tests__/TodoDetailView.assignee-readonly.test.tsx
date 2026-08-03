/**
 * TodoDetailView.assignee-readonly.test.tsx — regression test ensuring the
 * assignee picker was removed and cannot be written to.
 *
 * Proves that:
 * 1. The assignee renders as read-only with no interactive control
 * 2. No header interaction ever patches ownerSession/assigneeSession
 * 3. The patchSessionTodo API type excludes these fields
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TodoDetailView } from '../TodoDetailView';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionTodo } from '@/types/sessionTodo';
import path from 'path';
import fs from 'fs';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    patchSessionTodo: vi.fn().mockResolvedValue({}),
    resetTodo: vi.fn().mockResolvedValue({}),
  },
}));

// Import the mocked api after mocking
import { api } from '@/lib/api';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: 'other-session',
    title: p.id,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    acceptanceStatus: null,
    assigneeKind: null,
    claimedBy: null,
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

describe('TodoDetailView assignee read-only regression', () => {
  beforeEach(() => {
    // Set a non-null currentSession so changeStatus/save don't short-circuit
    useSessionStore.setState({
      sessionTodos: [todo({ id: 'T1' })],
      currentSession: { name: 'test-session', project: '/test' },
    });
  });

  it('renders the assignee as a read-only span with no interactive control or write on click', () => {
    (api.patchSessionTodo as Mock).mockClear();

    render(<TodoDetailView todoId="T1" />);

    // No assignee label/input control
    expect(screen.queryByLabelText('Assignee')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);

    // The assignee renders as a plain span, not a form control
    const assignee = screen.getByTestId('todo-detail-assignee');
    expect(assignee.tagName).not.toMatch(/^(SELECT|INPUT|BUTTON|TEXTAREA)$/);
    expect(assignee.textContent).toContain('other-session');

    // Clicking the assignee span does not trigger an API call
    fireEvent.click(assignee);
    expect(api.patchSessionTodo).not.toHaveBeenCalled();
  });

  it('no header interaction ever patches ownerSession or assigneeSession', async () => {
    const todoWithStatus = todo({
      id: 'T1',
      status: 'ready',
      approvedAt: '2026-06-16T00:00:00Z',
      heldAt: null,
    });
    useSessionStore.setState({
      sessionTodos: [todoWithStatus],
      currentSession: { name: 'test-session', project: '/test' },
    });

    (api.patchSessionTodo as Mock).mockClear();
    (api.patchSessionTodo as Mock).mockResolvedValue(todoWithStatus);

    render(<TodoDetailView todoId="T1" />);

    // Fire status menu interactions: Approve
    fireEvent.click(screen.getByTestId('todo-detail-status'));
    fireEvent.click(screen.getByTestId('todo-detail-approve'));

    // Wait a bit for async calls to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fire status menu again: Mark done
    fireEvent.click(screen.getByTestId('todo-detail-status'));
    const menuItems = screen.getAllByRole('menuitem');
    const markDoneButton = menuItems.find((item) => item.textContent?.includes('Mark done'));
    if (markDoneButton) fireEvent.click(markDoneButton);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fire status menu again: Drop
    fireEvent.click(screen.getByTestId('todo-detail-status'));
    const dropButton = screen.queryByRole('menuitem', { name: /Drop/i });
    if (dropButton) fireEvent.click(dropButton);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fire Hold button
    fireEvent.click(screen.getByTestId('todo-detail-hold'));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Fire Edit button and then Save
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Type in the title field (to ensure there's a change to save)
    const titleInput = screen.queryByPlaceholderText('Title') as HTMLInputElement;
    if (titleInput) {
      fireEvent.change(titleInput, { target: { value: 'Updated title' } });
    }

    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert every call to patchSessionTodo never included assignee fields
    expect((api.patchSessionTodo as Mock).mock.calls.length).toBeGreaterThan(0);
    for (const call of (api.patchSessionTodo as Mock).mock.calls) {
      const updates = call[3]; // 4th argument is the updates object
      expect(updates).not.toHaveProperty('ownerSession');
      expect(updates).not.toHaveProperty('assigneeSession');
    }
  });

  it('the patchSessionTodo updates type declares neither ownerSession nor assigneeSession', () => {
    const apiFilePath = path.resolve(__dirname, '../../../lib/api.ts');
    const apiContent = fs.readFileSync(apiFilePath, 'utf-8');

    // Find the patchSessionTodo interface line (around line 169)
    // We'll extract just the updates parameter type to check
    const patchSessionTodoMatch = apiContent.match(
      /patchSessionTodo\([^)]*updates:\s*\{[^}]*\}/s,
    );
    expect(patchSessionTodoMatch).not.toBeNull();

    if (patchSessionTodoMatch) {
      const signatureText = patchSessionTodoMatch[0];
      expect(signatureText).not.toContain('ownerSession');
      expect(signatureText).not.toContain('assigneeSession');
    }
  });
});
