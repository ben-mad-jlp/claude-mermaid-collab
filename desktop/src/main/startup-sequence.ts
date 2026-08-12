export interface StartupTimeline {
  spawnIssuedAt: number;
  spawnResolvedAt: number;
  remoteStartedAt: number | null;
  remoteResolvedAt: number | null;
  remoteOutcome: 'ok' | 'failed' | 'abandoned' | 'skipped';
}

export interface RunStartupSequenceDeps<T> {
  startSidecar: () => Promise<T>;
  connectRemotes: (sidecar: T) => Promise<void>;
  remoteBudgetMs?: number;
  clock?: () => number;
  onTimeline?: (t: StartupTimeline) => void;
}

export async function runStartupSequence<T>(deps: RunStartupSequenceDeps<T>): Promise<T> {
  const clock = deps.clock ?? Date.now;
  const spawnIssuedAt = clock();
  const sidecarPromise = deps.startSidecar();
  const sidecar = await sidecarPromise;
  const spawnResolvedAt = clock();

  const timeline: StartupTimeline = {
    spawnIssuedAt,
    spawnResolvedAt,
    remoteStartedAt: null,
    remoteResolvedAt: null,
    remoteOutcome: 'skipped',
  };

  const remoteStartedAt = clock();
  const remotePromise = deps.connectRemotes(sidecar);

  let settled = false;

  remotePromise
    .then(() => {
      if (!settled) {
        settled = true;
        timeline.remoteOutcome = 'ok';
        timeline.remoteResolvedAt = clock();
        timeline.remoteStartedAt = remoteStartedAt;
        deps.onTimeline?.(timeline);
      }
    })
    .catch(() => {
      if (!settled) {
        settled = true;
        timeline.remoteOutcome = 'failed';
        timeline.remoteResolvedAt = clock();
        timeline.remoteStartedAt = remoteStartedAt;
        deps.onTimeline?.(timeline);
      }
    });

  const remoteBudgetMs = deps.remoteBudgetMs ?? 5000;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        timeline.remoteOutcome = 'abandoned';
        timeline.remoteStartedAt = remoteStartedAt;
        deps.onTimeline?.(timeline);
      }
      resolve(sidecar);
    }, remoteBudgetMs);

    remotePromise
      .then(() => {
        clearTimeout(timeoutId);
        resolve(sidecar);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        resolve(sidecar);
      });
  });
}
