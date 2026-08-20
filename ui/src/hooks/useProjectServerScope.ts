import { useEffect, useMemo, useState } from 'react';
import { useServers } from '@/contexts/ServerContext';

/**
 * Resolve which server OWNS a project, for scoping the Bridge's reads and writes.
 *
 * WHY: the Bridge scoped everything to the CURRENT SESSION's server. With a session
 * open on a remote box, every lever, panel and toggle for a project on a different
 * machine asked the wrong server — and answered confidently. Observed 2026-08-20 with
 * a qbs/trimaxion session current: the conductor lever for two LOCAL projects read
 * `enabled:false` off the remote (which does not have those projects at all) while the
 * local server said `true`, so the switches showed OFF and clicking them would have
 * written the flag onto the remote for a project it never heard of. The same binding
 * produced the header's `(403)` lever badges and a phantom "No active mission".
 *
 * Ownership comes from each server's own watched-project list. A project claimed by
 * more than one server resolves to the LOCAL one — a same-path collision across
 * machines is a coincidence, and the local server is the safe place to act.
 *
 * Falls back to `fallback` (normally the session's server) while the lists load or for
 * a project no server claims, so behaviour degrades to exactly what it was before.
 */
export function useProjectServerScope(project: string | undefined, fallback: string): string {
  const { servers } = useServers();
  const [ownerByProject, setOwnerByProject] = useState<Record<string, string>>({});

  // Identity key so the effect re-runs when the server SET changes, not on every render.
  const serverKey = useMemo(() => servers.map((s) => `${s.id}:${s.status}`).join(','), [servers]);

  useEffect(() => {
    const mc = (window as never as { mc?: { invokeOnServer?: (id: string, o: unknown) => Promise<{ body?: { projects?: Array<{ project?: string }> } }> } }).mc;
    if (!mc?.invokeOnServer || servers.length === 0) return;
    let cancelled = false;

    // Query remotes first and the local server LAST so a duplicate path resolves local.
    const ordered = [...servers].sort((a, b) => Number(a.source === 'local') - Number(b.source === 'local'));

    void Promise.all(
      ordered.map(async (s) => {
        const res = await mc
          .invokeOnServer!(s.id, { path: '/api/supervisor/projects', method: 'GET' })
          .catch(() => null);
        const list = Array.isArray(res?.body?.projects) ? res!.body!.projects! : [];
        return list
          .map((w) => [w?.project, s.id] as const)
          .filter((pair): pair is readonly [string, string] => typeof pair[0] === 'string' && pair[0].length > 0);
      }),
    ).then((perServer) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const pairs of perServer) {
        for (const [p, id] of pairs) next[p] = id;
      }
      setOwnerByProject(next);
    });

    return () => { cancelled = true; };
  }, [serverKey, servers]);

  return (project && ownerByProject[project]) || fallback;
}
