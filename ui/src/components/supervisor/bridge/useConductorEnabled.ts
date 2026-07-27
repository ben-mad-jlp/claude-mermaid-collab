import { useCallback, useEffect, useState } from 'react';

export async function apiGet(path: string): Promise<any> {
  try {
    const mc = (window as any).mc;
    if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'GET' }))?.body ?? {};
    const r = await fetch(path);
    return r.ok ? r.json() : {};
  } catch {
    return {};
  }
}

export async function apiPost(path: string, body: unknown): Promise<any> {
  try {
    const mc = (window as any).mc;
    if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'POST', body }))?.body ?? {};
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? r.json() : {};
  } catch {
    return {};
  }
}

/** The conductor's last-pass heartbeat (supervisor-store getConductorLastPass). `reason` is
 *  'pass-ran' while a pass is IN-FLIGHT (stamped just before the node runs) and a terminal
 *  reason once it settles; `tickAt` is the epoch-ms of that stamp. */
export interface ConductorLastPass {
  missionId?: string | null;
  reason?: string | null;
  tickAt?: number | null;
}

export interface UseConductorEnabledResult {
  enabled: boolean | null;
  lastPass: ConductorLastPass | null;
  busy: boolean;
  setEnabled: (next: boolean) => Promise<void>;
}

export function useConductorEnabled(project: string): UseConductorEnabledResult {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [lastPass, setLastPass] = useState<ConductorLastPass | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const fetchEnabled = async () => {
      const data = await apiGet(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`);
      if (cancelled) return;
      if (typeof data.enabled === 'boolean') setEnabledState(data.enabled);
      if (data.lastPass && typeof data.lastPass === 'object') setLastPass(data.lastPass as ConductorLastPass);
    };
    void fetchEnabled().catch(() => {});
    const id = setInterval(() => { void fetchEnabled().catch(() => {}); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [project]);

  const setEnabled = useCallback(async (next: boolean) => {
    if (!project) return;
    const prev = enabled;
    setEnabledState(next); // optimistic
    setBusy(true);
    const data = await apiPost('/api/supervisor/conductor', { project, enabled: next });
    if (typeof data?.enabled === 'boolean') setEnabledState(data.enabled);
    else setEnabledState(prev);
    setBusy(false);
  }, [project, enabled]);

  return { enabled, lastPass, busy, setEnabled };
}
