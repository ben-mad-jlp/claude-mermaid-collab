import { describe, it, expect, beforeEach, vi } from 'vitest';

const LEGACY = 'supervisor-todos-by-project';
const V2 = 'supervisor-todos-by-project.v2';

async function freshStore() {
  vi.resetModules();
  const mod = await import('../supervisorStore');
  return mod.useSupervisorStore;
}

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

it('never reads a legacy pre-kind blob, and creating the store does not throw', async () => {
  localStorage.setItem(LEGACY, JSON.stringify({
    stud_feeder: [{ id: 'a1', title: '[EPIC] Inbox' }],   // no `kind`
  }));
  const useStore = await freshStore();                      // must not throw MissingKindError
  const byProject = useStore.getState().todosByProject;
  const rows = Object.values(byProject).flat();
  expect(rows).toHaveLength(0);
  expect(rows.some((r: any) => r.kind == null)).toBe(false);
  expect(localStorage.getItem(LEGACY)).toBeNull();          // legacy key removed
});

it('drops kind-less rows from the v2 blob and keeps the valid ones', async () => {
  localStorage.setItem(V2, JSON.stringify({
    p: [ { id: 'good', title: '[EPIC] Real', kind: 'epic' },
         { id: 'bad',  title: '[EPIC] Inbox' } ],
  }));
  const useStore = await freshStore();
  const rows = useStore.getState().todosByProject.p;
  expect(rows.map((r: any) => r.id)).toEqual(['good']);
});

it('drops a project entry that sanitizes to empty', async () => {
  localStorage.setItem(V2, JSON.stringify({ dead: [{ id: 'x', title: 'no kind' }] }));
  const useStore = await freshStore();
  expect(Object.keys(useStore.getState().todosByProject)).not.toContain('dead');
});
