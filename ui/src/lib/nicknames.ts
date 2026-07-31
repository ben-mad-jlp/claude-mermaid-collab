import { useEffect, useState } from 'react';

export async function fetchProjectNicknames(project: string): Promise<Record<string, string>> {
  const response = await fetch(`/api/supervisor/nicknames?project=${encodeURIComponent(project)}`);
  if (!response.ok) return {};
  const data = (await response.json()) as { nicknames?: Record<string, string> };
  return data.nicknames ?? {};
}

export function useProjectNicknames(project: string): Record<string, string> {
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void fetchProjectNicknames(project)
      .then((data) => {
        if (!cancelled) setNicknames(data);
      })
      .catch(() => {
        // Nicknames are a display nicety; a fetch failure (offline, test env,
        // transient 5xx) must not surface as an unhandled rejection — keep the
        // empty map. (An uncaught rejection here fails the whole vitest run,
        // exit 1, which reds every epic base gate.)
      });
    return () => { cancelled = true; };
  }, [project]);
  return nicknames;
}
