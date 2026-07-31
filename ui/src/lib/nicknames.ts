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
    void fetchProjectNicknames(project).then((data) => {
      if (!cancelled) setNicknames(data);
    });
    return () => { cancelled = true; };
  }, [project]);
  return nicknames;
}
