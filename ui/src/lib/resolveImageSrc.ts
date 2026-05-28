export interface ResolveImageSrcContext {
  project?: string;
  session?: string;
  theme?: string;
  serverId?: string;
}

function withServer(url: string, serverId?: string): string {
  if (!serverId || !url.startsWith('/api/')) return url;
  return `/srv/${encodeURIComponent(serverId)}${url}`;
}

/**
 * Resolve a markdown image `src` to a backend API endpoint when it matches
 * a collab-specific reference shape. Falls back to returning the raw src
 * unchanged for regular https/data URLs or when project/session missing.
 */
export function resolveImageSrc(
  src: string,
  ctx: ResolveImageSrcContext,
): string {
  const { project, session, theme = 'light', serverId } = ctx;
  if (!src) return src;

  // Absolute / non-http schemes pass through unchanged.
  if (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('//') ||
    src.startsWith('data:') ||
    src.startsWith('blob:')
  ) {
    return src;
  }

  // Raw /api/... paths get server-prefixed if serverId is set.
  if (src.startsWith('/api/')) {
    return withServer(src, serverId);
  }

  if (!project || !session) return src;

  const params = new URLSearchParams({ project, session });

  if (src.startsWith('@design/')) {
    const id = src.replace('@design/', '');
    return withServer(`/api/design/${id}/render?${params}`, serverId);
  }
  if (src.startsWith('@diagram/')) {
    const id = src.replace('@diagram/', '');
    return withServer(`/api/render/${id}?${params}&theme=${theme}`, serverId);
  }
  if (src.match(/^\.?\/?(designs?)\/(.+)$/)) {
    const id = src
      .replace(/^\.?\/?(designs?)\//, '')
      .replace(/\.(json|design)$/, '');
    return withServer(`/api/design/${id}/render?${params}`, serverId);
  }
  if (src.match(/^\.?\/?(diagrams?)\/(.+)$/)) {
    const id = src
      .replace(/^\.?\/?(diagrams?)\//, '')
      .replace(/\.mmd$/, '');
    return withServer(`/api/render/${id}?${params}&theme=${theme}`, serverId);
  }
  return src;
}
