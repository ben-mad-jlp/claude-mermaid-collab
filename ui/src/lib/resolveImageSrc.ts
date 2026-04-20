export interface ResolveImageSrcContext {
  project?: string;
  session?: string;
  theme?: string;
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
  const { project, session, theme = 'dark' } = ctx;
  if (!src) return src;
  if (!project || !session) return src;

  const params = new URLSearchParams({ project, session });

  if (src.startsWith('@design/')) {
    const id = src.replace('@design/', '');
    return `/api/design/${id}/render?${params}`;
  }
  if (src.startsWith('@diagram/')) {
    const id = src.replace('@diagram/', '');
    return `/api/render/${id}?${params}&theme=${theme}`;
  }
  if (src.match(/^\.?\/?(designs?)\/(.+)$/)) {
    const id = src
      .replace(/^\.?\/?(designs?)\//, '')
      .replace(/\.(json|design)$/, '');
    return `/api/design/${id}/render?${params}`;
  }
  if (src.match(/^\.?\/?(diagrams?)\/(.+)$/)) {
    const id = src
      .replace(/^\.?\/?(diagrams?)\//, '')
      .replace(/\.mmd$/, '');
    return `/api/render/${id}?${params}&theme=${theme}`;
  }
  return src;
}
