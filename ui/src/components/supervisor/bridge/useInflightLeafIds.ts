import { useEffect, useState } from 'react';
import { useLeafDaemon } from './leafDaemon';

/**
 * Live set of leaf todo ids the leaf-executor daemon reports as running for
 * `project`. Headless leaf runs never flip the todo's stored status, so this
 * ledger is the ONLY way the Plan surfaces can show a building leaf as in-flight.
 * Derives from useLeafDaemon's polling; returns a stable Set reference while the
 * membership is unchanged. Empty set when project is null.
 */
export function useInflightLeafIds(project: string | null, serverScope = ''): Set<string> {
  const { daemon } = useLeafDaemon(project, serverScope);
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!project) { setIds((prev) => (prev.size === 0 ? prev : new Set())); return; }
    const next: string[] = (daemon?.inflight ?? []).map((r) => r.leafId).filter((x): x is string => typeof x === 'string');
    setIds((prev) => (prev.size === next.length && next.every((i) => prev.has(i)) ? prev : new Set(next)));
  }, [daemon, project]);
  return ids;
}
