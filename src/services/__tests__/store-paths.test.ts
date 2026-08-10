/**
 * The store resolver is the structural fix for two measured failure classes (audit 2026-08-10):
 *
 *  - TWIN FILES: five logical stores existed in BOTH scopes. worker-ledger.db was 0 bytes
 *    project-local and 882MB global; todos.db the reverse. Opening the wrong twin returned a
 *    valid EMPTY database, so callers concluded "no data" instead of failing.
 *  - GHOSTS: 18 of 32 .db files were zero bytes, minted by `mkdirSync + new Database(path)` at
 *    whatever path a caller computed.
 *
 * These tests pin the properties that make those impossible rather than merely unlikely.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORES, storePath, existingStorePath, canonicalProjectRoot,
  ghostStoreFiles, knownStoreFiles, globalStoreDir,
} from '../store-paths';

let root: string;
const ORIGINAL_DIR = process.env.MERMAID_SUPERVISOR_DIR;

beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'store-paths-'))); });
afterEach(() => {
  if (ORIGINAL_DIR === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
  else process.env.MERMAID_SUPERVISOR_DIR = ORIGINAL_DIR;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('scope is enforced, so twin files cannot recur', () => {
  it('refuses a global store asked for project-locally', () => {
    // This is the exact call that produced an empty project-local worker-ledger.db.
    expect(() => storePath('workerLedger', root)).toThrow(/GLOBAL store and takes no project/);
  });

  it('refuses a project store asked for without a project', () => {
    expect(() => storePath('todos')).toThrow(/requires a project root/);
  });

  it('puts each store in exactly one scope', () => {
    const project = new Set(knownStoreFiles('project'));
    const global = new Set(knownStoreFiles('global'));
    for (const f of project) expect(global.has(f)).toBe(false);
    expect(project.size + global.size).toBe(Object.keys(STORES).length);
  });
});

describe('project roots are canonicalised, so one repo is one project', () => {
  it('rejects a bare project NAME instead of resolving it against cwd', () => {
    // Passing a name used to resolve relative to the process cwd and open an empty store
    // elsewhere — list_missions then answered {count: 0} for a project full of work.
    expect(() => canonicalProjectRoot('claude-mermaid-collab')).toThrow(/absolute path/);
  });

  it('resolves symlinked paths to the same root (the /tmp vs /private/tmp case)', () => {
    const link = join(tmpdir(), `store-paths-link-${Date.now()}`);
    try {
      require('node:fs').symlinkSync(root, link);
      expect(canonicalProjectRoot(link)).toBe(canonicalProjectRoot(root));
    } finally { try { rmSync(link, { force: true }); } catch { /* ignore */ } }
  });

  it('maps an agent-session worktree back to the repo root', () => {
    const wt = join(root, '.collab', 'agent-sessions', 'worktrees', 'leaf-exec-abc');
    mkdirSync(wt, { recursive: true });
    expect(canonicalProjectRoot(wt)).toBe(root);
  });

  it('maps a LINKED GIT WORKTREE back to its main repo', () => {
    // The old regex helper missed this entirely, so `git worktree add /tmp/wt-fix` became its
    // own "project" with its own empty databases.
    mkdirSync(join(root, '.git', 'worktrees', 'wt-fix'), { recursive: true });
    const wt = join(root, '..', `wt-fix-${Date.now()}`);
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${join(root, '.git', 'worktrees', 'wt-fix')}\n`);
    try {
      expect(canonicalProjectRoot(wt)).toBe(root);
    } finally { try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('normalises trailing slashes', () => {
    expect(canonicalProjectRoot(root + '/')).toBe(canonicalProjectRoot(root));
  });

  it('a real repo root is left alone', () => {
    mkdirSync(join(root, '.git'), { recursive: true }); // .git as a DIRECTORY = main checkout
    expect(canonicalProjectRoot(root)).toBe(root);
  });
});

describe('stores are not created by accident', () => {
  it('existingStorePath throws (naming the path) instead of creating an empty database', () => {
    expect(() => existingStorePath('todos', root)).toThrow(/does not exist at .*todos\.db/);
    expect(() => existingStorePath('todos', root)).toThrow(/Refusing to create it implicitly/);
  });

  it('existingStorePath returns the path once the store really exists', () => {
    mkdirSync(join(root, '.collab'), { recursive: true });
    writeFileSync(join(root, '.collab', 'todos.db'), '');
    expect(existingStorePath('todos', root)).toBe(join(root, '.collab', 'todos.db'));
  });
});

describe('ghost detection', () => {
  it('reports unowned .db files and leaves owned ones alone', () => {
    const dir = join(root, '.collab');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'todos.db'), '');        // owned
    writeFileSync(join(dir, 'mission.db'), '');      // owned
    writeFileSync(join(dir, 'coordinator.db'), '');  // ghost (0 bytes, unowned)
    writeFileSync(join(dir, 'worker-ledger.db'), ''); // ghost HERE: this store is global-only
    writeFileSync(join(dir, 'notes.md'), 'x');       // not a database
    const ghosts = ghostStoreFiles(dir, 'project').map((p) => p.split('/').pop()).sort();
    expect(ghosts).toEqual(['coordinator.db', 'worker-ledger.db']);
  });

  it('global scope owns a different set, so a project store found there is a ghost', () => {
    const dir = join(root, 'global');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'supervisor.db'), '');
    writeFileSync(join(dir, 'todos.db'), ''); // project store in the global dir = ghost
    expect(ghostStoreFiles(dir, 'global').map((p) => p.split('/').pop())).toEqual(['todos.db']);
  });
});

describe('global store dir', () => {
  it('honours the env override so tests and isolated runs cannot touch real data', () => {
    process.env.MERMAID_SUPERVISOR_DIR = root;
    expect(globalStoreDir()).toBe(root);
    expect(storePath('supervisor')).toBe(join(root, 'supervisor.db'));
  });
});
