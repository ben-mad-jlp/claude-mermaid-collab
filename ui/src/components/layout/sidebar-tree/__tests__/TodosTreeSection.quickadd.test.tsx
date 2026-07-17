/**
 * Sidebar quick-add files a todo via POST /api/workgraph/file-to-bucket
 * (fileToBucket), not the removed raw POST /api/session-todos creator.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const upsertSessionTodo = vi.fn();

const fixtureState = {
  currentSession: { project: 'proj-a', name: 'session-a', serverId: 'vd' },
  sessionTodos: [],
  upsertSessionTodo,
  setSessionTodos: vi.fn(),
};

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (selector: (s: typeof fixtureState) => unknown) => selector(fixtureState),
}));

vi.mock('@/stores/tabsStore', () => ({
  useTabsStore: (selector: (s: { openPreview: () => void }) => unknown) =>
    selector({ openPreview: vi.fn() }),
}));

import TodosTreeSection from '../TodosTreeSection';

describe('TodosTreeSection quick-add', () => {
  beforeEach(() => {
    upsertSessionTodo.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to /api/workgraph/file-to-bucket and stores the returned leaf', async () => {
    const leaf = { id: 'x', title: 'a thought' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ leaf }),
    } as Response);

    render(<TodosTreeSection />);

    const input = screen.getByLabelText('Add a new todo');
    fireEvent.change(input, { target: { value: 'a thought' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/workgraph/file-to-bucket');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      project: 'proj-a',
      session: 'session-a',
      title: 'a thought',
    });

    await waitFor(() => expect(upsertSessionTodo).toHaveBeenCalledWith(leaf));
  });
});
