// settings-store.ts
// Reads, merges, and writes the three-layer Claude Code settings files:
//   global:  ~/.claude/settings.json            (lowest precedence)
//   project: <cwd>/.claude/settings.json
//   local:   <cwd>/.claude/settings.local.json  (highest precedence)
//
// Atomic write: write to <path>.tmp, then rename — no partial writes.
// Managed-policy detection: presence of top-level `managedPolicy` key marks a file as org-enforced.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export type SettingsSource = 'global' | 'project' | 'local';

export interface TaggedRule {
  rule: string;
  source: SettingsSource;
}

export interface RawSettings {
  model?: string;
  effortLevel?: string;
  env?: Record<string, string>;
  permissions?: {
    allow?: string[];
    deny?: string[];
    additionalDirectories?: string[];
  };
  hooks?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
  managedPolicy?: unknown;
  [key: string]: unknown;
}

export interface MergedSettings {
  merged: RawSettings;
  allowRules: TaggedRule[];
  denyRules: TaggedRule[];
  isManagedPolicy: boolean;
  sources: SettingsSource[];
}

export function settingsFilePath(source: SettingsSource, cwd?: string): string {
  const base = cwd ?? process.cwd();
  switch (source) {
    case 'global':  return join(homedir(), '.claude', 'settings.json');
    case 'project': return join(base, '.claude', 'settings.json');
    case 'local':   return join(base, '.claude', 'settings.local.json');
  }
}

export async function readSettings(source: SettingsSource, cwd?: string): Promise<RawSettings | null> {
  const path = settingsFilePath(source, cwd);
  try {
    const text = await readFile(path, 'utf-8');
    if (!text.trim()) return null;
    return JSON.parse(text) as RawSettings;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function mergeSettings(cwd?: string): Promise<MergedSettings> {
  const [global_, project_, local_] = await Promise.all([
    readSettings('global', cwd),
    readSettings('project', cwd),
    readSettings('local', cwd),
  ]);

  const layers: Array<[RawSettings | null, SettingsSource]> = [
    [global_, 'global'],
    [project_, 'project'],
    [local_, 'local'],
  ];

  const sources: SettingsSource[] = layers
    .filter(([s]) => s !== null)
    .map(([, src]) => src);

  const merged: RawSettings = Object.assign(
    {},
    global_ ?? {},
    project_ ?? {},
    local_ ?? {},
  );

  // Merge env blocks (local wins per-key)
  const envMerged: Record<string, string> = {};
  for (const [s] of layers) {
    if (s?.env) Object.assign(envMerged, s.env);
  }
  if (Object.keys(envMerged).length > 0) merged.env = envMerged;

  const allowRules: TaggedRule[] = [];
  const denyRules: TaggedRule[] = [];

  for (const [s, src] of layers) {
    for (const rule of s?.permissions?.allow ?? []) allowRules.push({ rule, source: src });
    for (const rule of s?.permissions?.deny  ?? []) denyRules.push({ rule, source: src });
  }

  const isManagedPolicy = layers.some(([s]) => s !== null && 'managedPolicy' in (s as object));

  return { merged, allowRules, denyRules, isManagedPolicy, sources };
}

export async function writeSettings(settings: RawSettings, source: SettingsSource, cwd?: string): Promise<void> {
  const path = settingsFilePath(source, cwd);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  await rename(tmp, path);
}

export async function patchSettings(
  patch: Partial<RawSettings>,
  source: SettingsSource,
  cwd?: string,
): Promise<RawSettings> {
  const current = (await readSettings(source, cwd)) ?? {};

  const result: RawSettings = { ...current };

  // Scalar fields: patch wins
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'env' || k === 'enabledPlugins' || k === 'hooks' || k === 'permissions') continue;
    result[k] = v;
  }

  // Object merges
  if (patch.env) {
    result.env = { ...(current.env ?? {}), ...patch.env };
  }
  if (patch.enabledPlugins) {
    result.enabledPlugins = { ...(current.enabledPlugins ?? {}), ...patch.enabledPlugins };
  }
  if (patch.hooks) {
    result.hooks = { ...(current.hooks ?? {}), ...patch.hooks };
  }

  // Array concatenate + deduplicate for permissions
  if (patch.permissions) {
    const cur = current.permissions ?? {};
    const pat = patch.permissions;
    result.permissions = {
      allow: [...new Set([...(cur.allow ?? []), ...(pat.allow ?? [])])],
      deny:  [...new Set([...(cur.deny  ?? []), ...(pat.deny  ?? [])])],
      additionalDirectories: [...new Set([
        ...(cur.additionalDirectories ?? []),
        ...(pat.additionalDirectories ?? []),
      ])],
    };
  }

  await writeSettings(result, source, cwd);
  return result;
}

export function isManagedPolicyActive(settings: RawSettings): boolean {
  return 'managedPolicy' in settings && settings.managedPolicy != null;
}
