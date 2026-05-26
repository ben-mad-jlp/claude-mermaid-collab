/**
 * Derive a project-scoped, tmux-safe session name from (project, session).
 *
 * Keying tmux sessions by collab-session name alone collides when two projects
 * use the same session name. Including the project's folder basename disambiguates
 * them. No hyphens appear inside a slugged part, so the `mc-{basename}-{session}`
 * separators stay unambiguous (e.g. "ab"+"c" never equals "a"+"bc").
 *
 * Caveat: two different project paths whose last folder is identical
 * (e.g. ~/work/app and ~/personal/app) still collide — accepted for now.
 */
export function tmuxBaseName(project: string, session: string): string {
  const slug = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x';
  const basename = project.split('/').filter(Boolean).pop() ?? 'project';
  return `mc-${slug(basename)}-${slug(session)}`;
}
