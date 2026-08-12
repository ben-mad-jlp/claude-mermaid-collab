/**
 * `project` arguments must resolve to a real project or FAIL — never to an empty store.
 *
 * WHY (incident 2026-08-09/10): `list_missions {project: "claude-mermaid-collab"}` returned
 * {count: 0} for a project holding a live mission and 108 mission rows, and mission_diagnostic
 * said "mission not found". The name was not a path, so it resolved against the server's cwd to
 * a database that did not exist — which SQLite creates, empty. Every read then honestly reported
 * nothing. A watcher reading that concludes the work is finished and stops; it cost hours before
 * anyone doubted the empty answer.
 *
 * The invariant: a real path wins, a registered NAME resolves via the registry, anything else
 * throws naming what was tried. There is no path through this function that yields a usable
 * handle to a project that was not asked for.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { resolveProjectArg } from '../project-registry';

let dataDir: string;
let projA: string;
let projB: string;
const ORIGINAL_DATA_DIR = process.env.MERMAID_DATA_DIR;
const ORIGINAL_TRANSIENT = process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
const made: string[] = [];

function makeProject(name: string): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rpa-')));
  const p = join(base, name);
  mkdirSync(join(p, '.collab'), { recursive: true });
  made.push(base);
  return p;
}

/** Write a projects.json the registry's sync lister will read. */
function register(...paths: string[]) {
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({ projects: paths.map((p) => ({ path: p, name: basename(p), lastAccess: '' })) }),
  );
}

beforeEach(() => {
  dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'rpa-data-')));
  made.push(dataDir);
  process.env.MERMAID_DATA_DIR = dataDir;
  // These fixtures live under tmpdir; without this the registry treats them as transient
  // and refuses to list them, which would make every case here vacuously "unregistered".
  process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';
  projA = makeProject('alpha');
  projB = makeProject('beta');
});

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.MERMAID_DATA_DIR;
  else process.env.MERMAID_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_TRANSIENT === undefined) delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
  else process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = ORIGINAL_TRANSIENT;
  while (made.length) {
    try { rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('resolveProjectArg', () => {
  it('resolves a registered project NAME to its path — the incident case', () => {
    register(projA, projB);
    expect(resolveProjectArg('alpha')).toBe(projA);
  });

  it('THROWS on an unknown name instead of yielding an empty store', () => {
    register(projA);
    // The whole point: no silent success. The old behaviour returned a usable handle to a
    // database that did not exist, and every subsequent read reported "nothing here".
    expect(() => resolveProjectArg('not-a-project')).toThrow(/neither an existing path/);
  });

  it('names what it tried and what exists, so the error is actionable', () => {
    register(projA, projB);
    let msg = '';
    try { resolveProjectArg('typo-name'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('typo-name');
    expect(msg).toContain('alpha');
    expect(msg).toContain('beta');
  });

  it('an absolute path wins without consulting the registry', () => {
    register(); // registry deliberately empty
    expect(resolveProjectArg(projA)).toBe(projA);
  });

  it('canonicalises the path it returns (agent-session worktree → repo root)', () => {
    register(projA);
    const wt = join(projA, '.collab', 'agent-sessions', 'worktrees', 'leaf-exec-1');
    mkdirSync(wt, { recursive: true });
    expect(resolveProjectArg(wt)).toBe(projA);
  });

  it('refuses an ambiguous name rather than guessing', () => {
    const other = makeProject('alpha'); // same basename, different parent
    register(projA, other);
    expect(() => resolveProjectArg('alpha')).toThrow(/ambiguous/);
  });

  it('rejects empty input', () => {
    expect(() => resolveProjectArg('')).toThrow(/project is required/);
    expect(() => resolveProjectArg('   ')).toThrow(/project is required/);
  });
});
