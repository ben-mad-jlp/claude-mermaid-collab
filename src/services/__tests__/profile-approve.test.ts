// Runs via `bun test` (uses node:fs tmp dirs) — excluded from vitest.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPacks, resolveTechPacks } from '../../config/tech-packs';
import { loadProjectManifest, _clearManifestCache } from '../../config/project-manifest';
import { validateUiSpec } from '../escalation-ui-schema';
import type { PackCandidate } from '../profile-draft';
import {
  buildApprovalCard,
  applyApproval,
  toApprovalDecision,
  APPROVE_OPTION,
  REJECT_OPTION,
} from '../profile-approve';

let project: string;
let storeFile: string;

const CREATE: Extract<PackCandidate, { kind: 'create' }> = {
  kind: 'create',
  pack: { id: 'ros2', description: 'ROS2 robotics', contextPrompt: 'ROS2 domain knowledge', allowedTools: 'mcp__ros2' },
  rationale: 'ros2 recurs and no existing pack fits',
};
const ADOPT: Extract<PackCandidate, { kind: 'adopt' }> = {
  kind: 'adopt',
  packId: 'cad',
  rationale: 'cad already covers this cluster',
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'profile-approve-'));
  storeFile = join(mkdtempSync(join(tmpdir(), 'pa-store-')), 'tech-packs.json');
  process.env.MERMAID_TECH_PACKS_PATH = storeFile;
  _clearManifestCache();
});
afterEach(() => {
  delete process.env.MERMAID_TECH_PACKS_PATH;
  _clearManifestCache();
  rmSync(project, { recursive: true, force: true });
  rmSync(join(storeFile, '..'), { recursive: true, force: true });
});

describe('buildApprovalCard', () => {
  it('builds a server-valid card (closed catalog + terminal action) for CREATE', () => {
    const card = buildApprovalCard(CREATE);
    // survives the server-side validator → not silently dropped
    expect(validateUiSpec(card)).not.toBeNull();
    expect(card.elements.some((e) => e.type === 'DiffView')).toBe(true);
    expect(card.elements.some((e) => e.type === 'OptionButton' && e.optionId === APPROVE_OPTION)).toBe(true);
    expect(card.elements.some((e) => e.type === 'OptionButton' && e.optionId === REJECT_OPTION)).toBe(true);
  });

  it('builds a server-valid card for ADOPT', () => {
    const card = buildApprovalCard(ADOPT);
    expect(validateUiSpec(card)).not.toBeNull();
    expect(card.elements.some((e) => e.type === 'Heading' && e.text.includes('cad'))).toBe(true);
  });
});

describe('toApprovalDecision', () => {
  it('maps the approve id to approve and everything else to reject (fail safe)', () => {
    expect(toApprovalDecision(APPROVE_OPTION)).toBe(APPROVE_OPTION);
    expect(toApprovalDecision(REJECT_OPTION)).toBe(REJECT_OPTION);
    expect(toApprovalDecision('whatever')).toBe(REJECT_OPTION);
    expect(toApprovalDecision(null)).toBe(REJECT_OPTION);
  });
});

describe('applyApproval', () => {
  it('APPROVE + CREATE persists the pack via L4b (then visible to the resolver)', () => {
    expect(listPacks().some((p) => p.id === 'ros2')).toBe(false);
    const res = applyApproval(project, CREATE, APPROVE_OPTION);
    expect(res).toMatchObject({ decision: APPROVE_OPTION, applied: true, kind: 'create' });
    // now resolvable cross-project without a code change
    expect(listPacks().some((p) => p.id === 'ros2')).toBe(true);
    expect(resolveTechPacks(['ros2']).map((p) => p.id)).toEqual(['ros2']);
  });

  it('APPROVE + ADOPT declares the pack id in the project manifest', () => {
    const res = applyApproval(project, ADOPT, APPROVE_OPTION);
    expect(res).toMatchObject({ decision: APPROVE_OPTION, applied: true, kind: 'adopt', packId: 'cad' });
    _clearManifestCache();
    expect(loadProjectManifest(project)?.packs).toContain('cad');
  });

  it('REJECT drops a CREATE candidate — nothing persisted', () => {
    const res = applyApproval(project, CREATE, REJECT_OPTION);
    expect(res).toEqual({ decision: REJECT_OPTION, applied: false });
    expect(listPacks().some((p) => p.id === 'ros2')).toBe(false);
  });

  it('REJECT drops an ADOPT candidate — manifest untouched', () => {
    const res = applyApproval(project, ADOPT, REJECT_OPTION);
    expect(res).toEqual({ decision: REJECT_OPTION, applied: false });
    expect(loadProjectManifest(project)).toBeNull();
  });
});
