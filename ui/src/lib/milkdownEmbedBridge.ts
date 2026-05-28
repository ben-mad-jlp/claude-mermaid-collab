export type EmbedKind = 'diagram' | 'design';

export const EMBED_RE = /\{\{(diagram|design):([^}]+)\}\}/;

export function resolveEmbedSrc(
  kind: EmbedKind,
  refId: string,
  project: string | undefined,
  session: string | undefined,
  theme = 'dark',
  serverId?: string,
): string | null {
  if (!project || !session) return null;
  const params = new URLSearchParams({ project, session });
  let url: string;
  if (kind === 'design') {
    url = `/api/design/${encodeURIComponent(refId)}/render?${params.toString()}`;
  } else {
    url = `/api/render/${encodeURIComponent(refId)}?${params.toString()}&theme=${encodeURIComponent(theme ?? 'dark')}`;
  }
  if (serverId && url.startsWith('/api/')) {
    url = `/srv/${encodeURIComponent(serverId)}${url}`;
  }
  return url;
}
