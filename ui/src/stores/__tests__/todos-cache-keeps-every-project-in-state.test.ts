/**
 * The todos cache size limit bounds STORAGE, never STATE.
 *
 * Regression: persistTodosCache returned its evicted map as store state, so one
 * oversized project stripped the others out of `todosByProject`. Measured live on
 * 2026-08-20: this repo's own work-graph is ~4,600 rows ≈ 8 MB — four times the
 * 2 MB cap on its own — so every per-project load evicted the rest and the rail's
 * project cards showed data for only the project that loaded last, churning as the
 * loaders took turns. Project cards are a global summary and must render for every
 * watched project whatever is selected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TODOS_KEY = 'supervisor-todos-by-project.v2';

async function freshStore() {
  vi.resetModules();
  const mod = await import('../supervisorStore');
  return mod;
}

/** Rows fat enough that two projects blow a 2 MB cap. */
function fatRows(project: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${project}-${i}`,
    title: `row ${i} ${'x'.repeat(2000)}`,
    kind: 'leaf',
    status: 'todo',
  }));
}

function mockTodos(byProject: Record<string, unknown[]>) {
  (window as any).mc = {
    invokeOnServer: (_s: string, opts: { path: string }) => {
      const m = /project=([^&]+)/.exec(opts.path);
      const project = m ? decodeURIComponent(m[1]) : '';
      if (opts.path.startsWith('/api/supervisor/todos')) {
        return Promise.resolve({ ok: true, status: 200, body: { todos: byProject[project] ?? [] } });
      }
      // loadUnlandedEpics rides along after loadProjectTodos.
      return Promise.resolve({ ok: true, status: 200, body: { unlandedEpics: [] } });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete (window as any).mc;
});

describe('todos cache: storage is bounded, state is not', () => {
  it('keeps EVERY loaded project in state even when the blob far exceeds the cap', async () => {
    const A = '/repo/big';
    const B = '/repo/small';
    mockTodos({ [A]: fatRows('a', 1200), [B]: fatRows('b', 5) });

    const { useSupervisorStore } = await freshStore();
    await useSupervisorStore.getState().loadProjectTodos('local', A);
    await useSupervisorStore.getState().loadProjectTodos('local', B);

    const state = useSupervisorStore.getState().todosByProject;
    expect(Object.keys(state).sort()).toEqual([A, B].sort());
    expect(state[A].length).toBe(1200);
    expect(state[B].length).toBe(5);
  });

  it('a project loaded earlier survives a later oversized project load', async () => {
    const SMALL = '/repo/small';
    const HUGE = '/repo/huge';
    mockTodos({ [SMALL]: fatRows('s', 3), [HUGE]: fatRows('h', 1500) });

    const { useSupervisorStore } = await freshStore();
    await useSupervisorStore.getState().loadProjectTodos('local', SMALL);
    await useSupervisorStore.getState().loadProjectTodos('local', HUGE);

    const state = useSupervisorStore.getState().todosByProject;
    expect(state[SMALL]).toBeDefined();
    expect(state[SMALL].length).toBe(3);
  });

  it('the persisted copy stays within the cap (storage bound still enforced)', async () => {
    const A = '/repo/big';
    const B = '/repo/small';
    mockTodos({ [A]: fatRows('a', 1200), [B]: fatRows('b', 5) });

    const { useSupervisorStore, TODOS_CACHE_MAX_BYTES } = await freshStore();
    await useSupervisorStore.getState().loadProjectTodos('local', A);
    await useSupervisorStore.getState().loadProjectTodos('local', B);

    const raw = localStorage.getItem(TODOS_KEY);
    if (raw !== null) {
      expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(TODOS_CACHE_MAX_BYTES);
    }
  });
});
