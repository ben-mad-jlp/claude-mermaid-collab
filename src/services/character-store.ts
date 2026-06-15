/**
 * Character store (game-asset toolkit, T1 "character asset").
 *
 * A CHARACTER is a reusable identity for a game actor — a reference image + locked
 * palette + style fragment — so every animation sheet generated for it reads as the
 * SAME character. Generation tools reference a character instead of re-describing it
 * each time.
 *
 *   { name, description?, referenceImageId?, palette?, stylePromptFragment? }
 *
 * Persisted one JSON per character under the session folder, matching project-style:
 *   <project>/.collab/sessions/<session>/characters/<slug>.json
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';

export interface CharacterDef {
  /** Display name (also the file slug source). */
  name: string;
  /** Free-text description used to generate/condition the character. */
  description?: string;
  /** Session image id of the canonical reference (locks identity via img2img). */
  referenceImageId?: string;
  /** Fixed palette (hex) snapped onto every sheet for this character. */
  palette?: string[];
  /** Phrase appended to every prompt for this character (aesthetic steer). */
  stylePromptFragment?: string;
}

export function characterSlug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'character';
}

function charDir(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'characters');
}
function charPath(project: string, session: string, name: string): string {
  return join(charDir(project, session), `${characterSlug(name)}.json`);
}

export async function saveCharacter(project: string, session: string, def: CharacterDef): Promise<CharacterDef> {
  const normalized = normalize(def);
  await mkdir(charDir(project, session), { recursive: true });
  await writeFile(charPath(project, session, normalized.name), JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export async function loadCharacter(project: string, session: string, name: string): Promise<CharacterDef | null> {
  try {
    const raw = await readFile(charPath(project, session, name), 'utf-8');
    return normalize(JSON.parse(raw) as CharacterDef);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function listCharacters(project: string, session: string): Promise<CharacterDef[]> {
  try {
    const files = (await readdir(charDir(project, session))).filter((f) => f.endsWith('.json'));
    const out: CharacterDef[] = [];
    for (const f of files) {
      try { out.push(normalize(JSON.parse(await readFile(join(charDir(project, session), f), 'utf-8')))); } catch { /* skip corrupt */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

function normalize(def: CharacterDef): CharacterDef {
  const out: CharacterDef = { name: (def.name ?? '').trim() || 'character' };
  if (typeof def.description === 'string' && def.description.trim()) out.description = def.description.trim();
  if (typeof def.referenceImageId === 'string' && def.referenceImageId.trim()) out.referenceImageId = def.referenceImageId.trim();
  if (typeof def.stylePromptFragment === 'string' && def.stylePromptFragment.trim()) out.stylePromptFragment = def.stylePromptFragment.trim();
  if (Array.isArray(def.palette)) {
    const palette = def.palette.filter((c) => typeof c === 'string').map(normalizeHex).filter((c): c is string => c !== null);
    if (palette.length) out.palette = palette;
  }
  return out;
}
function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

/** Named action-set presets — convenience bundles; callers can also pass an explicit list. */
export const ACTION_PRESETS: Record<string, string[]> = {
  fighter: ['idle', 'walk', 'attack', 'block', 'hit', 'KO'],
  platformer: ['idle', 'run', 'jump', 'fall', 'hurt'],
  topdown: ['idle', 'walk', 'attack', 'hurt', 'die'],
};

/** Resolve actions from an explicit list and/or a preset name (union, de-duped, order-preserving). */
export function resolveActions(actions?: string[], preset?: string): string[] {
  const fromPreset = preset && ACTION_PRESETS[preset] ? ACTION_PRESETS[preset] : [];
  const merged = [...fromPreset, ...(actions ?? [])]
    .map((a) => (typeof a === 'string' ? a.trim() : ''))
    .filter(Boolean);
  return [...new Set(merged)];
}
