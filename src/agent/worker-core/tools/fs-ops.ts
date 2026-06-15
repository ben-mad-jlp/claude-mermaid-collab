/**
 * Worktree-scoped filesystem operations — the execute bodies behind the read/write/
 * edit worker tools. Pure-ish (fs + injected cwd); the AI-SDK `tool()` wrappers add
 * the zod schema. Every path is guarded so a tool can never touch outside the lane's
 * worktree (the isolation seam).
 */
import { resolve, dirname } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { applyEdit } from './apply-edit';
import { formatRead, type ReadResult } from './read-file';

/** Resolve `p` under `cwd` and reject any escape. Hardened vs a naive
 *  `startsWith(cwd)` (which would wrongly admit a sibling like `${cwd}-other`):
 *  the resolved path must BE the worktree root or live strictly beneath it. */
export function safePath(cwd: string, p: string): string {
  const abs = resolve(cwd, p);
  if (abs !== cwd && !abs.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')) {
    throw new Error(`path escapes the worktree: ${p}`);
  }
  return abs;
}

/** Read a worktree file, formatted with line numbers + pagination. Returns an
 *  `error` string instead of throwing on a missing file (the model can react). */
export function readFileOp(
  cwd: string,
  path: string,
  opts: { offset?: number; limit?: number } = {},
): (ReadResult & { path: string }) | { error: string } {
  const abs = safePath(cwd, path);
  if (!existsSync(abs)) return { error: `no such file: ${path}` };
  return { path, ...formatRead(readFileSync(abs, 'utf8'), opts) };
}

/** Write a worktree file (creating parent dirs). Overwrites. */
export function writeFileOp(cwd: string, path: string, content: string): { ok: true; path: string } {
  const abs = safePath(cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return { ok: true, path };
}

/** Edit a worktree file via the harvested applyEdit cascade. Returns an `error`
 *  string on a missing file or an ambiguous/not-found match (never corrupts). */
export function editFileOp(
  cwd: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { ok: true; path: string } | { error: string } {
  const abs = safePath(cwd, path);
  if (!existsSync(abs)) return { error: `no such file: ${path}` };
  try {
    const next = applyEdit(readFileSync(abs, 'utf8'), oldString, newString, replaceAll);
    writeFileSync(abs, next);
    return { ok: true, path };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
