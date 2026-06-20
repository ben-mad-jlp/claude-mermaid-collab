export type OptimisticStatus = 'pending' | 'committing' | 'committed' | 'reverted' | 'rejected';

/** One staged optimistic action. `key` is a caller-supplied dedupe/identity key
 *  (e.g. escalation id) so re-staging the same target supersedes the prior pending
 *  action instead of double-applying. */
export interface OptimisticAction {
  id: string;
  key: string;
  label: string;
  status: OptimisticStatus;
  stagedAt: number;
  commitAt: number;
}

export interface StageInput {
  key: string;
  label: string;
  apply: () => void;
  revert: () => void;
  commit: () => Promise<boolean>;
  undoWindowMs?: number;
}

export interface OptimisticControllerOptions {
  undoWindowMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onChange?: (action: OptimisticAction) => void;
  onReconcileFail?: (action: OptimisticAction, error?: unknown) => void;
}

export interface OptimisticController {
  stage: (input: StageInput) => string;
  undo: (id: string) => boolean;
  flush: () => Promise<void>;
  cancelAll: () => void;
  list: () => OptimisticAction[];
  dispose: () => void;
}

let seq = 0;

export function createOptimisticController(opts?: OptimisticControllerOptions): OptimisticController {
  const defaultUndoWindowMs = opts?.undoWindowMs ?? 5000;
  const now = opts?.now ?? (() => Date.now());
  const setTimer = opts?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts?.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const onChange = opts?.onChange;
  const onReconcileFail = opts?.onReconcileFail;

  interface Entry {
    action: OptimisticAction;
    revert: () => void;
    commit: () => Promise<boolean>;
    timer: unknown;
  }

  const actions = new Map<string, Entry>();
  const byKey = new Map<string, string>(); // key -> id

  const genId = () => 'opt_' + (++seq) + '_' + now();

  async function runCommit(id: string): Promise<void> {
    const entry = actions.get(id);
    if (!entry || entry.action.status !== 'pending') return;

    entry.action.status = 'committing';
    onChange?.(entry.action);

    try {
      const ok = await entry.commit();
      if (ok) {
        entry.action.status = 'committed';
        onChange?.(entry.action);
      } else {
        entry.revert();
        entry.action.status = 'rejected';
        onChange?.(entry.action);
        onReconcileFail?.(entry.action);
      }
    } catch (e) {
      entry.revert();
      entry.action.status = 'rejected';
      onChange?.(entry.action);
      onReconcileFail?.(entry.action, e);
    }
  }

  function stage(input: StageInput): string {
    const windowMs = input.undoWindowMs ?? defaultUndoWindowMs;

    // Supersede any existing pending action with the same key:
    // commit the prior immediately so its intent is not lost.
    const priorId = byKey.get(input.key);
    if (priorId !== undefined) {
      const prior = actions.get(priorId);
      if (prior && prior.action.status === 'pending') {
        clearTimer(prior.timer);
        prior.timer = null;
        // fire-and-forget: commit prior before staging new
        runCommit(priorId);
      }
    }

    const id = genId();
    const stagedAt = now();
    const action: OptimisticAction = {
      id,
      key: input.key,
      label: input.label,
      status: 'pending',
      stagedAt,
      commitAt: stagedAt + windowMs,
    };

    input.apply();

    const timer = setTimer(() => { runCommit(id); }, windowMs);

    actions.set(id, { action, revert: input.revert, commit: input.commit, timer });
    byKey.set(input.key, id);

    onChange?.(action);

    return id;
  }

  function undo(id: string): boolean {
    const entry = actions.get(id);
    if (!entry || entry.action.status !== 'pending') return false;

    clearTimer(entry.timer);
    entry.revert();
    entry.action.status = 'reverted';
    onChange?.(entry.action);

    return true;
  }

  async function flush(): Promise<void> {
    const pending: string[] = [];
    for (const [id, entry] of actions) {
      if (entry.action.status === 'pending') {
        clearTimer(entry.timer);
        pending.push(id);
      }
    }
    await Promise.all(pending.map(id => runCommit(id)));
  }

  function cancelAll(): void {
    for (const [, entry] of actions) {
      if (entry.action.status === 'pending') {
        clearTimer(entry.timer);
        entry.revert();
        entry.action.status = 'reverted';
        onChange?.(entry.action);
      }
    }
  }

  function list(): OptimisticAction[] {
    return [...actions.values()].map(v => v.action);
  }

  function dispose(): void {
    for (const [, entry] of actions) {
      clearTimer(entry.timer);
    }
    actions.clear();
    byKey.clear();
  }

  return { stage, undo, flush, cancelAll, list, dispose };
}
