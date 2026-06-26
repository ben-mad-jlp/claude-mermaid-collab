import { useEffect, useState } from 'react';

/**
 * Live set of leaf todo ids the leaf-executor daemon reports as running for
 * `project`. Headless leaf runs never flip the todo's stored status, so this
 * ledger is the ONLY way the Plan surfaces can show a building leaf as in-flight.
 * Polls GET /api/leaf-executor/daemon?project=… every 4 s; returns a stable Set
 * reference while the membership is unchanged. Empty set when project is null.
 */
export function useInflightLeafIds(project: string | null): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!project) { setIds(new Set()); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/leaf-executor/daemon?project=${encodeURIComponent(project)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        const next: string[] = Array.isArray(d?.inflight)
          ? d.inflight.map((r: { leafId?: string }) => r.leafId).filter((x: unknown): x is string => typeof x === 'string')
          : [];
        setIds((prev) => (prev.size === next.length && next.every((i) => prev.has(i)) ? prev : new Set(next)));
      } catch { /* best-effort; keep last good */ }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, 4_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [project]);
  return ids;
}
