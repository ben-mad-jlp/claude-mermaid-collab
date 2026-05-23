import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: any) => fn,
}));

import { SessionTodosSection, SessionTodosSectionHandle } from '../SessionTodosSection';
import * as useSessionStoreModule from '@/stores/sessionStore';
import * as apiModule from '@/lib/api';
import { SessionTodo } from '@/types';

describe('SessionTodosSection', () => {
  let mockUseSessionStore: ReturnType<typeof vi.spyOn>;

  const baseSession = {
    project: '/tmp/proj',
    name: 'sess-1',
    displayName: 'Session 1',
  } as any;

  const makeTodo = (over: Partial<SessionTodo> = {}): SessionTodo => ({
    id: 1,
    text: 'Write tests',
    completed: false,
    order: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  const makeState = (overrides: any = {}) => ({
    currentSession: baseSession,
    sessionTodos: [] as SessionTodo[],
    sessionTodosShowCompleted: false,
    setSessionTodos: vi.fn(),
    upsertSessionTodo: vi.fn(),
    removeSessionTodoLocal: vi.fn(),
    setSessionTodosList: vi.fn(),
    setSessionTodosShowCompleted: vi.fn(),
    selectDocument: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionStore = vi.spyOn(useSessionStoreModule, 'useSessionStore');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockStore = (state: any) => {
    mockUseSessionStore.mockImplementation((selector?: any) =>
      selector ? selector(state) : state,
    );
    (useSessionStoreModule.useSessionStore as any).getState = () => state;
  };

  it('returns null when there is no current session', () => {
    mockStore(makeState({ currentSession: null }));
    const { container } = render(<SessionTodosSection />);
    expect(container.firstChild).toBeNull();
  });

  it('renders header with count badge', () => {
    mockStore(
      makeState({
        sessionTodos: [makeTodo(), makeTodo({ id: 2, text: 'Another' })],
      }),
    );
    render(<SessionTodosSection />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('hides completed by default and shows them when checkbox toggles', () => {
    const setSessionTodosShowCompleted = vi.fn();
    mockStore(
      makeState({
        sessionTodos: [
          makeTodo({ id: 1, text: 'Open task', completed: false }),
          makeTodo({ id: 2, text: 'Done task', completed: true }),
        ],
        setSessionTodosShowCompleted,
      }),
    );
    render(<SessionTodosSection />);
    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.queryByText('Done task')).toBeNull();

    const showCompleted = screen.getByLabelText('Show completed');
    fireEvent.click(showCompleted);
    expect(setSessionTodosShowCompleted).toHaveBeenCalledWith(true);
  });

  it('adds a todo on Enter', async () => {
    const upsertSessionTodo = vi.fn();
    const addSpy = vi
      .spyOn(apiModule.api, 'addSessionTodo')
      .mockResolvedValue(makeTodo({ id: 42, text: 'New item' }));
    mockStore(makeState({ upsertSessionTodo }));

    render(<SessionTodosSection />);
    const input = screen.getByLabelText('Add a new todo');
    fireEvent.change(input, { target: { value: 'New item' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith('/tmp/proj', 'sess-1', 'New item');
    });
    await waitFor(() => {
      expect(upsertSessionTodo).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, text: 'New item' }),
      );
    });
  });

  it('opens confirm dialog and clears completed', async () => {
    const setSessionTodos = vi.fn();
    const clearSpy = vi
      .spyOn(apiModule.api, 'clearCompletedSessionTodos')
      .mockResolvedValue({ removedCount: 1 });
    mockStore(
      makeState({
        sessionTodos: [
          makeTodo({ id: 1, completed: true }),
          makeTodo({ id: 2, text: 'Keep', completed: false }),
        ],
        sessionTodosShowCompleted: true,
        setSessionTodos,
      }),
    );

    render(<SessionTodosSection />);
    fireEvent.click(screen.getByText('Clear completed'));
    expect(screen.getByText(/Clear Completed Todos/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(clearSpy).toHaveBeenCalledWith('/tmp/proj', 'sess-1');
    });
    expect(setSessionTodos).toHaveBeenCalled();
  });

  it('toggles a todo via checkbox', async () => {
    const upsertSessionTodo = vi.fn();
    const patchSpy = vi
      .spyOn(apiModule.api, 'patchSessionTodo')
      .mockResolvedValue(makeTodo({ completed: true }));
    mockStore(
      makeState({
        sessionTodos: [makeTodo()],
        upsertSessionTodo,
      }),
    );

    render(<SessionTodosSection />);
    const checkbox = screen.getByLabelText('Toggle Write tests');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/tmp/proj', 'sess-1', 1, {
        completed: true,
      });
    });
  });

  it('deletes a todo via delete button', async () => {
    const removeSessionTodoLocal = vi.fn();
    const removeSpy = vi
      .spyOn(apiModule.api, 'removeSessionTodo')
      .mockResolvedValue(undefined);
    mockStore(
      makeState({
        sessionTodos: [makeTodo()],
        removeSessionTodoLocal,
      }),
    );

    render(<SessionTodosSection />);
    fireEvent.click(screen.getByLabelText('Delete Write tests'));

    expect(removeSessionTodoLocal).toHaveBeenCalledWith(1);
    await waitFor(() => {
      expect(removeSpy).toHaveBeenCalledWith('/tmp/proj', 'sess-1', 1);
    });
  });

  it('uses external collapsed prop when provided', () => {
    mockStore(makeState());
    const { rerender } = render(<SessionTodosSection collapsed={true} />);
    expect(screen.queryByLabelText('Add a new todo')).toBeNull();

    rerender(<SessionTodosSection collapsed={false} />);
    expect(screen.getByLabelText('Add a new todo')).toBeInTheDocument();
  });

  it('invokes onToggle on header click when provided', () => {
    mockStore(makeState());
    const onToggle = vi.fn();
    render(<SessionTodosSection collapsed={false} onToggle={onToggle} />);

    const headerButton = screen.getByText('Todos').closest('button')!;
    fireEvent.click(headerButton);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Add a new todo')).toBeInTheDocument();
  });

  describe('link chip', () => {
    it('renders chip with shortSlug and taskId when todo has a link', () => {
      mockStore(
        makeState({
          sessionTodos: [
            makeTodo({
              link: { blueprintId: 'Implementing/Go/Wave 3/foo', taskId: 'bar' },
            }),
          ],
        }),
      );
      render(<SessionTodosSection />);
      const chip = screen.getByTestId('todo-link-chip');
      expect(chip).toBeInTheDocument();
      expect(chip.textContent).toContain('Wave 3/foo');
      expect(chip.textContent).toContain('bar');
    });

    it('does not render chip when todo has no link', () => {
      mockStore(
        makeState({
          sessionTodos: [makeTodo()],
        }),
      );
      render(<SessionTodosSection />);
      expect(screen.queryByTestId('todo-link-chip')).toBeNull();
    });

    it('clicking the chip calls selectDocument with the blueprintId', () => {
      const selectDocument = vi.fn();
      mockStore(
        makeState({
          sessionTodos: [
            makeTodo({
              link: { blueprintId: 'Implementing/Go/Wave 3/foo', taskId: 'bar' },
            }),
          ],
          selectDocument,
        }),
      );
      render(<SessionTodosSection />);
      const chip = screen.getByTestId('todo-link-chip');
      fireEvent.click(chip);
      expect(selectDocument).toHaveBeenCalledWith('Implementing/Go/Wave 3/foo');
    });
  });

  it('revealAddInput imperative handle focuses the add input', async () => {
    mockStore(makeState());
    const ref = React.createRef<SessionTodosSectionHandle>();
    render(<SessionTodosSection ref={ref} />);

    act(() => {
      ref.current!.revealAddInput();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Add a new todo'));
    });
  });
});
