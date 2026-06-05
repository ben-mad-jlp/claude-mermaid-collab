// Runs via `bun test` (uses node:fs tmp dirs) — excluded from vitest.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _clearManifestCache } from '../project-manifest';
import { TECH_PACKS, resolveTechPacks, resolveManifestPacks } from '../tech-packs';

let project: string;

function writeManifest(obj: unknown): void {
  mkdirSync(join(project, '.collab'), { recursive: true });
  writeFileSync(join(project, '.collab', 'project.json'), JSON.stringify(obj), 'utf8');
  _clearManifestCache(project);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'techpacks-'));
});
afterEach(() => {
  _clearManifestCache(project);
  rmSync(project, { recursive: true, force: true });
});

describe('tech-pack registry', () => {
  it('seeds the cad + web-react packs with id/contextPrompt/allowedTools fragments', () => {
    expect(TECH_PACKS.cad?.id).toBe('cad');
    expect(TECH_PACKS.cad?.contextPrompt).toContain('build123d');
    expect(TECH_PACKS.cad?.allowedTools).toContain('mcp__build123d');
    expect(TECH_PACKS['web-react']?.contextPrompt).toContain('React');
  });

  it('resolveTechPacks resolves known ids, drops unknown + duplicate ids', () => {
    const packs = resolveTechPacks(['cad', 'nope', 'cad', 'web-react']);
    expect(packs.map((p) => p.id)).toEqual(['cad', 'web-react']);
  });

  it('resolveTechPacks returns [] for empty/missing input', () => {
    expect(resolveTechPacks([])).toEqual([]);
    expect(resolveTechPacks(null)).toEqual([]);
    expect(resolveTechPacks(undefined)).toEqual([]);
  });
});

describe('resolveManifestPacks (project DECLARES ids, packs resolve cross-project)', () => {
  it('no manifest → no packs, no primary', () => {
    const r = resolveManifestPacks(project);
    expect(r.packs).toEqual([]);
    expect(r.primary).toBeUndefined();
  });

  it('a manifest referencing shared pack ids resolves to context+tools fragments', () => {
    writeManifest({ version: 1, packs: ['cad'], primaryPack: 'cad' });
    const r = resolveManifestPacks(project);
    expect(r.packs.map((p) => p.id)).toEqual(['cad']);
    expect(r.primary?.id).toBe('cad');
    expect(r.primary?.contextPrompt).toContain('CAD');
    expect(r.primary?.allowedTools).toContain('mcp__build123d');
  });

  it('a primaryPack not listed in packs is still honoured if it resolves', () => {
    writeManifest({ version: 1, packs: ['web-react'], primaryPack: 'cad' });
    const r = resolveManifestPacks(project);
    expect(r.packs.map((p) => p.id).sort()).toEqual(['cad', 'web-react']);
    expect(r.primary?.id).toBe('cad');
  });

  it('unknown declared ids degrade gracefully (dropped, never thrown)', () => {
    writeManifest({ version: 1, packs: ['ros2', 'cad'], primaryPack: 'ros2' });
    const r = resolveManifestPacks(project);
    expect(r.packs.map((p) => p.id)).toEqual(['cad']);
    expect(r.primary).toBeUndefined(); // primary 'ros2' isn't in the registry
  });
});
