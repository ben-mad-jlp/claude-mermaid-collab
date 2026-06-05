// Runs via `bun test` (uses node:fs tmp dirs) — excluded from vitest.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProjectManifest, manifestProfile, inferTypeFromManifest, _clearManifestCache,
} from '../project-manifest';
import { resolveProfile, AGENT_PROFILES, DEFAULT_PROFILE_TYPE } from '../agent-profiles';

let project: string;

function writeManifest(obj: unknown): void {
  mkdirSync(join(project, '.collab'), { recursive: true });
  writeFileSync(join(project, '.collab', 'project.json'), JSON.stringify(obj), 'utf8');
  _clearManifestCache(project);
}

const CAD = {
  version: 1,
  profiles: {
    cad: {
      allowedTools: 'Bash Edit Write Read mcp__mermaid mcp__build123d',
      contextPrompt: 'You are working in build123d-ocp-mcp. Use python3.10 -m pytest.',
      model: 'claude-opus-4-8',
      runtimeMode: 'edit',
      pathRules: [{ type: 'cad', test: '\\.(step|stp|parts)$|(^|/)parts/' }],
    },
  },
  gateCommand: 'python3.10 -m pytest bsync-tools/tests -q',
  metricRefs: ['workspace_vol_cm3', 'median_cond'],
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'manifest-'));
});
afterEach(() => {
  _clearManifestCache(project);
  rmSync(project, { recursive: true, force: true });
});

describe('project-manifest reader', () => {
  it('returns null when no manifest exists', () => {
    expect(loadProjectManifest(project)).toBeNull();
  });

  it('returns null (never throws) for a malformed manifest', () => {
    mkdirSync(join(project, '.collab'), { recursive: true });
    writeFileSync(join(project, '.collab', 'project.json'), '{ not valid json', 'utf8');
    _clearManifestCache(project);
    expect(loadProjectManifest(project)).toBeNull();
  });

  it('parses gateCommand + metricRefs + profiles', () => {
    writeManifest(CAD);
    const m = loadProjectManifest(project)!;
    expect(m.gateCommand).toBe('python3.10 -m pytest bsync-tools/tests -q');
    expect(m.metricRefs).toEqual(['workspace_vol_cm3', 'median_cond']);
    expect(m.profiles?.cad?.contextPrompt).toContain('build123d');
  });

  it('manifestProfile returns the declared profile, or null for unknown type', () => {
    writeManifest(CAD);
    expect(manifestProfile(project, 'cad')?.model).toBe('claude-opus-4-8');
    expect(manifestProfile(project, 'frontend')).toBeNull();
    expect(manifestProfile(project, null)).toBeNull();
  });

  it('inferTypeFromManifest matches a project path-rule (.step → cad), null otherwise', () => {
    writeManifest(CAD);
    expect(inferTypeFromManifest(project, ['models/arm.step'])).toBe('cad');
    expect(inferTypeFromManifest(project, ['parts/base.py'])).toBe('cad');
    expect(inferTypeFromManifest(project, ['src/index.ts'])).toBeNull();
    expect(inferTypeFromManifest(project, [])).toBeNull();
  });
});

describe('resolveProfile manifest merge (SEAM·collab)', () => {
  it('no project arg → returns the exact global profile object (reference identity preserved)', () => {
    expect(resolveProfile('frontend')).toBe(AGENT_PROFILES.frontend);
    expect(resolveProfile(undefined)).toBe(AGENT_PROFILES[DEFAULT_PROFILE_TYPE]);
  });

  it('project with NO manifest → still the global profile by reference', () => {
    expect(resolveProfile('backend', project)).toBe(AGENT_PROFILES.backend);
  });

  it('a type=cad todo resolves to the project-declared cad profile (tools + contextPrompt injected)', () => {
    writeManifest(CAD);
    const p = resolveProfile('cad', project);
    expect(p.allowedTools).toContain('mcp__build123d');
    expect(p.contextPrompt).toContain('build123d-ocp-mcp');
    expect(p.model).toBe('claude-opus-4-8');
    expect(p.runtimeMode).toBe('edit');
  });

  it('manifest fields override the global base; omitted fields keep the global', () => {
    // Override only contextPrompt for the global `backend` type; allowedTools stays global.
    writeManifest({ profiles: { backend: { contextPrompt: 'backend domain notes' } } });
    const p = resolveProfile('backend', project);
    expect(p.contextPrompt).toBe('backend domain notes');
    expect(p.allowedTools).toBe(AGENT_PROFILES.backend.allowedTools); // untouched global
  });
});
