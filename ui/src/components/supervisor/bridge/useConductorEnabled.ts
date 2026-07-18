import { useCallback, useEffect, useState } from 'react';

export async function apiGet(path: string): Promise<any> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'GET' }))?.body ?? {};
  const r = await fetch(path);
  return r.ok ? r.json() : {};
}

export async function apiPost(path: string, body: unknown): Promise<any> {
  const mc = (window as any).mc;
  if (mc?.invokeOnServer) return (await mc.invokeOnServer('local', { path, method: 'POST', body }))?.body ?? {};
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok ? r.json() : {};
}

export interface UseConductorEnabledResult {
  enabled: boolean | null;
  busy: boolean;
  setEnabled: (next: boolean) => Promise<void>;
}

export function useConductorEnabled(project: string): UseConductorEnabledResult {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const fetchEnabled = async () => {
      const data = await apiGet(`/api/supervisor/conductor?project=${encodeURIComponent(project)}`);
      if (!cancelled && typeof data.enabled === 'boolean') setEnabledState(data.enabled);
    };
    void fetchEnabled();
    const id = setInterval(fetchEnabled, 10_000);
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

  return { enabled, busy, setEnabled };
}
