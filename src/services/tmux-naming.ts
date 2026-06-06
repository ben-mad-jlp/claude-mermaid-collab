import { trackingProjectRoot } from './project-registry.js';

/**
 * Derive a project-scoped, tmux-safe session name from (project, session).
 *
 * Keying tmux sessions by collab-session name alone collides when two projects
 * use the same session name. Including the project's folder basename disambiguates
 * them. No hyphens appear inside a slugged part, so the `mc-{basename}-{session}`
 * separators stay unambiguous (e.g. "ab"+"c" never equals "a"+"bc").
 *
 * `project` is normalized through trackingProjectRoot first: under worker
 * isolation a worker's cwd is a worktree at <repo>/.collab/agent-sessions/
 * worktrees/<lane>, whose basename is the POOL LANE (e.g. `backend-3`). If such a
 * path reaches here unmapped, the name becomes `mc-backend3-…` instead of
 * `mc-{repo}-…`, so the real worker tmux can never be attached/viewed. Mapping
 * back to the repo root keeps every derivation pinned to the tracking project.
 *
 * Caveat: two different project paths whose last folder is identical
 * (e.g. ~/work/app and ~/personal/app) still collide — accepted for now.
 */
export function tmuxBaseName(project: string, session: string): string {
  const slug = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x';
  const root = trackingProjectRoot(project);
  const basename = root.split('/').filter(Boolean).pop() ?? 'project';
  return `mc-${slug(basename)}-${slug(session)}`;
}
