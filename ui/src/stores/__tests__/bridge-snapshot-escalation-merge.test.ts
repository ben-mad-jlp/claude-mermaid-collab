/**
 * bridge-snapshot escalation MERGE (per project) — rail-blanking falsifier.
 *
 * `loadBridgeSnapshot` reads ONE project's snapshot, but `openEscalations` is a single
 * global set that the whole project rail renders from. Writing the snapshot's cards with
 * a plain replace blanked every project card except the last one refreshed: each lit up
 * as its snapshot resolved, then went gray when the next project's landed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Snapshot body carrying only `project`'s open cards. */
function snapshotFor(project: string, ids: string[]) {
  return {
    ok: true,
    status: 200,
    body: {
      openEscalations: ids.map((id) => ({
        id,
        project,
        kind: 'blocker',
        status: 'open',
        audience: 'human',
        createdAt: 1,
      })),
    },
  };
}

/** Route each snapshot GET to the project named in its query string. */
function mockSnapshots(byProject: Record<string, string[]>) {
  (window as any).mc = {
    invokeOnServer: (_serverId: string, opts: { path: string }) => {
      const m = /project=([^&]+)/.exec(opts.path);
      const project = m ? decodeURIComponent(m[1]) : '';
      return Promise.resolve(snapshotFor(project, byProject[project] ?? []));
    },
  };
}

async function freshStore() {
  vi.resetModules();
  const mod = await import('../supervisorStore');
  return mod.useSupervisorStore;
}

const A = '/repo/alpha';
const B = '/repo/beta';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete (window as any).mc;
});

describe('loadBridgeSnapshot merges escalations per project', () => {
  it('keeps project A cards after project B loads (both projects present)', async () => {
    mockSnapshots({ [A]: ['a1'], [B]: ['b1'] });
    const useStore = await freshStore();

    await useStore.getState().loadBridgeSnapshot('local', A);
    await useStore.getState().loadBridgeSnapshot('local', B);

    const open = useStore.getState().openEscalations;
    expect(open).toHaveLength(2);
    expect(open.map((e: any) => e.id).sort()).toEqual(['a1', 'b1']);
  });

  it('refreshing project A swaps only A\'s slice and leaves B\'s ids intact', async () => {
    mockSnapshots({ [A]: ['a1'], [B]: ['b1'] });
    const useStore = await freshStore();

    await useStore.getState().loadBridgeSnapshot('local', A);
    await useStore.getState().loadBridgeSnapshot('local', B);

    // A's next snapshot carries a DIFFERENT single card.
    mockSnapshots({ [A]: ['a2'], [B]: ['b1'] });
    await useStore.getState().loadBridgeSnapshot('local', A);

    const open = useStore.getState().openEscalations;
    expect(open).toHaveLength(2);
    expect(open.map((e: any) => e.id).sort()).toEqual(['a2', 'b1']);
  });

  it('every entry carries the project it was fetched for', async () => {
    mockSnapshots({ [A]: ['a1'], [B]: ['b1'] });
    const useStore = await freshStore();

    await useStore.getState().loadBridgeSnapshot('local', A);
    await useStore.getState().loadBridgeSnapshot('local', B);

    const byId = Object.fromEntries(
      useStore.getState().openEscalations.map((e: any) => [e.id, e.project]),
    );
    expect(byId).toEqual({ a1: A, b1: B });
  });
});
