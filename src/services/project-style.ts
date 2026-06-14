/**
 * Project style — the cohesive-look knobs shared across every generated asset in a
 * session (T1). A session has at most ONE style:
 *
 *   { palette, stylePromptFragment }
 *
 *   - palette: a fixed list of hex colors snapped onto every generated sprite/tile/prop
 *     so separately-generated assets share one retro look (passed to the downscale
 *     quantize step).
 *   - stylePromptFragment: a short phrase appended to every generation prompt
 *     (e.g. "16-bit SNES pixel art, muted earth tones") so the model also aims at the
 *     same aesthetic before the palette snap.
 *
 * Persisted as a single JSON file under the session folder, matching the convention
 * used by browser-setups / terminal-manager:
 *   <project>/.collab/sessions/<session>/style.json
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export interface ProjectStyle {
  /** Fixed palette as hex colors ('#rrggbb'). Applied via the downscale quantize step. */
  palette?: string[];
  /** Phrase appended to every generation prompt to steer the aesthetic. */
  stylePromptFragment?: string;
}

function stylePath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'style.json');
}

/** Load the session's project style, or null if none has been set. */
export async function loadProjectStyle(project: string, session: string): Promise<ProjectStyle | null> {
  try {
    const raw = await readFile(stylePath(project, session), 'utf-8');
    const parsed = JSON.parse(raw) as ProjectStyle;
    return normalizeStyle(parsed);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Persist (overwrite) the session's project style. */
export async function saveProjectStyle(project: string, session: string, style: ProjectStyle): Promise<ProjectStyle> {
  const normalized = normalizeStyle(style);
  const path = stylePath(project, session);
  await mkdir(join(project, '.collab', 'sessions', session), { recursive: true });
  await writeFile(path, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function normalizeStyle(style: ProjectStyle): ProjectStyle {
  const out: ProjectStyle = {};
  if (Array.isArray(style.palette)) {
    const palette = style.palette
      .filter((c) => typeof c === 'string')
      .map((c) => normalizeHex(c))
      .filter((c): c is string => c !== null);
    if (palette.length) out.palette = palette;
  }
  if (typeof style.stylePromptFragment === 'string' && style.stylePromptFragment.trim()) {
    out.stylePromptFragment = style.stylePromptFragment.trim();
  }
  return out;
}

/** Normalize a hex color to lowercase '#rrggbb', expanding shorthand; null if invalid. */
function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

/**
 * Append a style's prompt fragment to a generation prompt. Idempotent-ish: if the
 * fragment is already present at the tail it is not duplicated.
 */
export function applyStyleToPrompt(prompt: string, style: ProjectStyle | null | undefined): string {
  const frag = style?.stylePromptFragment;
  if (!frag) return prompt;
  if (prompt.toLowerCase().includes(frag.toLowerCase())) return prompt;
  return `${prompt.trim()}, ${frag}`;
}
