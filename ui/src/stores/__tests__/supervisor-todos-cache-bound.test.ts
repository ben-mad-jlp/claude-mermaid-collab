import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TODOS_KEY = 'supervisor-todos-by-project.v2';

async function freshStore() {
  vi.resetModules();
  const mod = await import('../supervisorStore');
  return mod.useSupervisorStore;
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supervisor todos cache bounds', () => {
  it('the persisted cache stays under its size bound', async () => {
    // Stub fetch to return large todos for multiple projects
    vi.stubGlobal('fetch', vi.fn((path: string) => {
      if (path.includes('/api/supervisor/todos')) {
        const project = new URL(path, 'http://localhost').searchParams.get('project');
        // Return ~1 MB of todos for each project
        const todos = Array.from({ length: 200 }, (_, i) => ({
          id: `todo-${project}-${i}`,
          title: `[LEAF] Todo ${i} in ${project}`,
          kind: 'leaf',
          body: 'x'.repeat(5000), // ~5KB per todo
        }));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ todos }),
        });
      }
      if (path.includes('/api/supervisor/unlanded-epics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ unlandedEpics: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }));

    const { TODOS_CACHE_MAX_BYTES } = await import('../supervisorStore');
    const useStore = await freshStore();
    const store = useStore.getState();

    // Load three projects in order: old, mid, new
    // Each returns ~1 MB of todos
    await store.loadProjectTodos('local', 'old');
    await store.loadProjectTodos('local', 'mid');
    await store.loadProjectTodos('local', 'new');

    // Verify the persisted cache is under the byte limit
    const persisted = localStorage.getItem(TODOS_KEY);
    expect(persisted).not.toBeNull();
    const persistedBytes = new TextEncoder().encode(persisted!).length;
    expect(persistedBytes).toBeLessThanOrEqual(TODOS_CACHE_MAX_BYTES);

    // Verify the oldest project was evicted
    const persistedMap = JSON.parse(persisted!);
    expect(persistedMap).not.toHaveProperty('old');
    expect(persistedMap).toHaveProperty('new');

    // Verify mid may or may not be present depending on exact sizes
    // (either could be evicted to stay under the cap)
  });

  it('a quota error never breaks the store', async () => {
    // Create store first (before stubbing setItem)
    const useStore = await freshStore();

    // Stub fetch to return todos
    vi.stubGlobal('fetch', vi.fn((path: string) => {
      if (path.includes('/api/supervisor/todos')) {
        const todos = Array.from({ length: 50 }, (_, i) => ({
          id: `todo-${i}`,
          title: `[LEAF] Todo ${i}`,
          kind: 'leaf',
          body: 'test todo',
        }));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ todos }),
        });
      }
      if (path.includes('/api/supervisor/unlanded-epics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ unlandedEpics: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }));

    // Stub setItem to throw QuotaExceededError (AFTER store creation)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    // This should not throw, even though setItem fails
    await expect(useStore.getState().loadProjectTodos('local', 'p1')).resolves.not.toThrow();

    // The store state should still be populated even though the cache write failed
    // (get a fresh state after the async call completes)
    const updatedState = useStore.getState();
    expect(updatedState.todosByProject['p1']).toBeDefined();
    expect(updatedState.todosByProject['p1'].length).toBeGreaterThan(0);
  });
});
