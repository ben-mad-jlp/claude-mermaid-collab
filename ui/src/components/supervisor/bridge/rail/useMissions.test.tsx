import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function makeDeferredPromise<T>(): DeferredPromise<T> {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

const makeMissionSummary = (project: string, title: string) => ({
  node: { id: `m-${project}`, title: `[MISSION] ${title}` },
  mission: { active: true, phase: 'execute', iteration: 1, maxIterations: null, description: '', procedure: '' },
  rollup: { phase: 'execute', stopped: false, status: 'building', criteriaMet: 0, criteriaTotal: 2, mechDone: 0, mechTotal: 1 },
  criteria: [{ id: 'c1', text: 'C1', met: false, order: 0 }],
  epics: [],
});

let deferredA: DeferredPromise<any[]>;
let deferredB: DeferredPromise<any[]>;
let mockFetchMissions: any;

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => {
    if (sel) {
      return sel({
        fetchMissions: (serverId: string, project: string) => {
          if (project === '/projA') return deferredA.promise;
          if (project === '/projB') return deferredB.promise;
          return Promise.resolve([]);
        },
      });
    }
    return {
      fetchMissions: (serverId: string, project: string) => {
        if (project === '/projA') return deferredA.promise;
        if (project === '/projB') return deferredB.promise;
        return Promise.resolve([]);
      },
    };
  },
}));

import { MissionStrip } from '../MissionStrip';

describe('useMissions — key-tag stale-project blanking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blanks stale project content synchronously when switching projects in-flight', async () => {
    deferredA = makeDeferredPromise<any[]>();
    deferredB = makeDeferredPromise<any[]>();

    const { rerender } = render(
      <MissionStrip serverId="s" project="/projA" onOpenMissions={() => {}} />
    );

    // Project A's fetch is in flight; idle label shows.
    await waitFor(() => {
      expect(screen.getByTestId('mission-strip-idle-label')).toBeInTheDocument();
    });
    expect(screen.queryByText('Project A Mission')).toBeNull();

    // Switch to project B before A resolves.
    rerender(
      <MissionStrip serverId="s" project="/projB" onOpenMissions={() => {}} />
    );

    // Even though A's fetch was first, B's fetch is now the active one.
    // The idle label should still show (B not yet resolved).
    await waitFor(() => {
      expect(screen.getByTestId('mission-strip-idle-label')).toBeInTheDocument();
    });
    expect(screen.queryByText('Project A Mission')).toBeNull();
    expect(screen.queryByText('Project B Mission')).toBeNull();

    // Now resolve B's fetch.
    deferredB.resolve([makeMissionSummary('/projB', 'Project B Mission')]);

    // B's mission should now render.
    await waitFor(() => {
      expect(screen.getByText('Project B Mission')).toBeInTheDocument();
    });
    expect(screen.queryByText('Project A Mission')).toBeNull();

    // Resolve A's fetch after B is already shown.
    deferredA.resolve([makeMissionSummary('/projA', 'Project A Mission')]);

    // A's content should NEVER appear — it should remain blanked because the key doesn't match.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText('Project A Mission')).toBeNull();
    expect(screen.getByText('Project B Mission')).toBeInTheDocument();
  });

  it('rejects stale project fetch when it resolves after switch', async () => {
    deferredA = makeDeferredPromise<any[]>();
    deferredB = makeDeferredPromise<any[]>();

    const { rerender } = render(
      <MissionStrip serverId="s" project="/projA" onOpenMissions={() => {}} />
    );

    // Project A fetch is in flight.
    await waitFor(() => {
      expect(screen.getByTestId('mission-strip-idle-label')).toBeInTheDocument();
    });

    // Switch to B.
    rerender(
      <MissionStrip serverId="s" project="/projB" onOpenMissions={() => {}} />
    );

    // B idle state.
    await waitFor(() => {
      expect(screen.getByTestId('mission-strip-idle-label')).toBeInTheDocument();
    });

    // Resolve B first.
    deferredB.resolve([makeMissionSummary('/projB', 'Project B Mission')]);

    // B renders.
    await waitFor(() => {
      expect(screen.getByText('Project B Mission')).toBeInTheDocument();
    });

    // Now resolve the stale A fetch (after B is already shown).
    deferredA.resolve([makeMissionSummary('/projA', 'Project A Mission')]);

    // A's content must never appear.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText('Project A Mission')).toBeNull();
    expect(screen.getByText('Project B Mission')).toBeInTheDocument();
  });

  it('blanks already-rendered project A content synchronously on switch to B', async () => {
    deferredA = makeDeferredPromise<any[]>();
    deferredB = makeDeferredPromise<any[]>();

    const { rerender } = render(
      <MissionStrip serverId="s" project="/projA" onOpenMissions={() => {}} />
    );

    deferredA.resolve([makeMissionSummary('/projA', 'Project A Mission')]);
    await waitFor(() => {
      expect(screen.getByText('Project A Mission')).toBeInTheDocument();
    });

    rerender(
      <MissionStrip serverId="s" project="/projB" onOpenMissions={() => {}} />
    );

    expect(screen.queryByText('Project A Mission')).toBeNull();
    expect(screen.getByTestId('mission-strip-idle-label')).toBeInTheDocument();
  });
});
