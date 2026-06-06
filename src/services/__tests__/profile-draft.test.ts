// Runs via `bun test` (uses bun:sqlite + node:fs tmp dirs) — excluded from vitest.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction, _closeProject } from '../friction-store';
import { registerPack } from '../../config/tech-packs';
import type { ProfileOpportunity } from '../profile-opportunity';
import {
  gatherEvidence,
  buildProposerPrompt,
  parsePackCandidate,
  draftPackCandidate,
} from '../profile-draft';

let project: string;
let storeFile: string;

const OPP: ProfileOpportunity = {
  key: 'parts,step',
  todoIds: ['t1', 't2', 't3', 't4'],
  exts: ['parts', 'step'],
  dirs: ['cad'],
  sampleFiles: ['cad/bracket.parts', 'cad/bracket.step'],
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'profile-draft-'));
  storeFile = join(mkdtempSync(join(tmpdir(), 'pd-store-')), 'tech-packs.json');
  process.env.MERMAID_TECH_PACKS_PATH = storeFile;
});
afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_TECH_PACKS_PATH;
  rmSync(project, { recursive: true, force: true });
  rmSync(join(storeFile, '..'), { recursive: true, force: true });
});

describe('gatherEvidence', () => {
  it('collects friction for the cluster todos + the current pack library', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    await recordFriction(project, { todoId: 't9', layer: 'domain', retryReason: 'unrelated' });
    const ev = gatherEvidence(project, OPP);
    expect(ev.frictionNotes.map((f) => f.todoId)).toEqual(['t1']); // t9 not in cluster
    expect(ev.existingPacks.map((p) => p.id)).toContain('cad'); // seed library present
  });
});

describe('buildProposerPrompt', () => {
  it('carries the signature, friction, and existing-pack evidence into the prompt', () => {
    const ev = gatherEvidence(project, OPP);
    const prompt = buildProposerPrompt(ev);
    expect(prompt).toContain('parts,step');
    expect(prompt).toContain('cad/bracket.step');
    expect(prompt).toContain('cad:'); // existing pack listed for ADOPT
    expect(prompt).toContain('ADOPT');
    expect(prompt).toContain('CREATE');
  });
});

describe('parsePackCandidate', () => {
  const known = ['cad', 'web-react'];

  it('parses a well-formed ADOPT candidate against a known id', () => {
    const c = parsePackCandidate('{"kind":"adopt","packId":"cad","rationale":"cad fits"}', known);
    expect(c).toEqual({ kind: 'adopt', packId: 'cad', rationale: 'cad fits' });
  });

  it('parses a well-formed CREATE candidate (new kebab id)', () => {
    const raw = JSON.stringify({
      kind: 'create',
      pack: { id: 'ros2', description: 'ROS2 robotics', contextPrompt: 'ROS2 domain knowledge', allowedTools: '' },
      rationale: 'ros2 recurs, no pack fits',
    });
    const c = parsePackCandidate(raw, known);
    expect(c.kind).toBe('create');
    if (c.kind === 'create') expect(c.pack.id).toBe('ros2');
  });

  it('tolerates code fences / surrounding prose', () => {
    const c = parsePackCandidate('Here:\n```json\n{"kind":"adopt","packId":"cad","rationale":"x"}\n```', known);
    expect(c.kind).toBe('adopt');
  });

  it('rejects ADOPT of an unknown id', () => {
    expect(() => parsePackCandidate('{"kind":"adopt","packId":"nope","rationale":"x"}', known)).toThrow(/unknown packId/);
  });

  it('rejects CREATE that collides with a known id (should be adopt)', () => {
    const raw = JSON.stringify({ kind: 'create', pack: { id: 'cad', description: 'd', contextPrompt: 'c', allowedTools: '' }, rationale: 'x' });
    expect(() => parsePackCandidate(raw, known)).toThrow(/already exists/);
  });

  it('rejects CREATE with a non-kebab id', () => {
    const raw = JSON.stringify({ kind: 'create', pack: { id: 'ROS 2', description: 'd', contextPrompt: 'c', allowedTools: '' }, rationale: 'x' });
    expect(() => parsePackCandidate(raw, known)).toThrow(/kebab/);
  });

  it('rejects CREATE missing required fields', () => {
    const raw = JSON.stringify({ kind: 'create', pack: { id: 'ros2', description: '', contextPrompt: 'c', allowedTools: '' }, rationale: 'x' });
    expect(() => parsePackCandidate(raw, known)).toThrow(/description is required/);
  });

  it('rejects a missing rationale', () => {
    expect(() => parsePackCandidate('{"kind":"adopt","packId":"cad"}', known)).toThrow(/rationale/);
  });

  it('rejects an unknown kind', () => {
    expect(() => parsePackCandidate('{"kind":"maybe","rationale":"x"}', known)).toThrow(/kind must be/);
  });

  it('rejects a reply with no JSON', () => {
    expect(() => parsePackCandidate('no json here', known)).toThrow(/no JSON/);
  });
});

describe('draftPackCandidate (agent mocked)', () => {
  it('emits a CREATE candidate when the mocked agent proposes a new pack', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    const candidate = await draftPackCandidate(project, OPP, {
      runAgent: async ({ prompt }) => {
        // the agent sees the evidence...
        expect(prompt).toContain('parts,step');
        return JSON.stringify({
          kind: 'create',
          pack: { id: 'cad-parts', description: 'parts/step CAD', contextPrompt: 'parts domain', allowedTools: '' },
          rationale: 'recurs',
        });
      },
    });
    expect(candidate.kind).toBe('create');
    if (candidate.kind === 'create') expect(candidate.pack.id).toBe('cad-parts');
  });

  it('emits an ADOPT candidate referencing a registered (stored) pack', async () => {
    registerPack({ id: 'cad-pro', description: 'pro cad', contextPrompt: 'x', allowedTools: '' });
    const candidate = await draftPackCandidate(project, OPP, {
      runAgent: async () => '{"kind":"adopt","packId":"cad-pro","rationale":"already have it"}',
    });
    expect(candidate).toEqual({ kind: 'adopt', packId: 'cad-pro', rationale: 'already have it' });
  });

  it('propagates a validation error from a malformed agent reply', async () => {
    await expect(
      draftPackCandidate(project, OPP, { runAgent: async () => '{"kind":"adopt","packId":"ghost","rationale":"x"}' }),
    ).rejects.toThrow(/unknown packId/);
  });
});
