export type EmbedKind = 'diagram' | 'design';

export const EMBED_RE = /\{\{(diagram|design):([^}]+)\}\}/;

export function resolveEmbedSrc(
  kind: EmbedKind,
  refId: string,
  project: string | undefined,
  session: string | undefined,
  theme = 'dark',
): string | null {
  if (!project || !session) return null;
  const params = new URLSearchParams({ project, session });
  if (kind === 'design') {
    return `/api/design/${encodeURIComponent(refId)}/render?${params.toString()}`;
  }
  return `/api/render/${encodeURIComponent(refId)}?${params.toString()}&theme=${encodeURIComponent(theme ?? 'dark')}`;
}
