/**
 * The registry path must follow MERMAID_DATA_DIR at USE time, not import time.
 *
 * Bun runs every test file in one process and caches modules, so a module-load constant
 * captures whichever importer loaded first. mailbox-isolation.test.ts sets MERMAID_DATA_DIR
 * before its own dynamic import, but a sibling had already loaded session-registry without
 * it — so the registry wrote to the real ~/.mermaid-collab and the hermetic tripwire threw.
 * Two tests failed only when the directory ran together (2026-08-21), and the land gate
 * blamed whichever unrelated file the epic happened to touch.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { SessionRegistry } from '../session-registry.ts';

const pathOf = (r: SessionRegistry) => (r as unknown as { registryPath: string }).registryPath;
const dirs: string[] = [];
const freshDir = () => { const d = mkdtempSync(join(tmpdir(), 'sr-lazy-')); dirs.push(d); return d; };

afterEach(() => {
  delete process.env.MERMAID_DATA_DIR;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('SessionRegistry default path resolution', () => {
  it('follows MERMAID_DATA_DIR set AFTER the module was imported', () => {
    const dir = freshDir();
    process.env.MERMAID_DATA_DIR = dir;
    expect(pathOf(new SessionRegistry())).toBe(join(dir, 'sessions.json'));
  });

  it('re-resolves when the variable changes between uses', () => {
    const first = freshDir();
    process.env.MERMAID_DATA_DIR = first;
    const reg = new SessionRegistry();
    expect(pathOf(reg)).toBe(join(first, 'sessions.json'));
    const second = freshDir();
    process.env.MERMAID_DATA_DIR = second;
    expect(pathOf(reg)).toBe(join(second, 'sessions.json'));
  });

  it('falls back to the home data dir when the variable is absent', () => {
    delete process.env.MERMAID_DATA_DIR;
    expect(pathOf(new SessionRegistry())).toBe(join(homedir(), '.mermaid-collab', 'sessions.json'));
  });

  it('an explicit path is never overridden by the environment', () => {
    const explicit = join(freshDir(), 'custom.json');
    const reg = new SessionRegistry(explicit);
    process.env.MERMAID_DATA_DIR = freshDir();
    expect(pathOf(reg)).toBe(explicit);
  });
});
