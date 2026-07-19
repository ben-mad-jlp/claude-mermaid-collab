import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The global supervisor DB (node_profile_override) caches its handle by MERMAID_SUPERVISOR_DIR;
// keep it STABLE (not the churned per-test project dir) so forgeMissionFromDoc's model resolution
// doesn't hit a removed file. Per-PROJECT stores (mission/todo/decision) stay fresh via the project path.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-forge-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-forge-'));
});

// Imports AFTER the env is set so any db opens against our temp dir.
import { forgeMission, missionConstitutionHealth, forgeMissionFromDoc, approveMissionAndConstitution, parseForgeSpec } from '../mission-forge';
import { getMission, listCriteria, _resetMissionDbCache } from '../../../services/mission-store';
import { listDecisionRecords, _closeProject as closeDecisions } from '../../../services/decision-record-store';
import { getTodo, _closeProject as closeTodos } from '../../../services/todo-store';
import { composeInjectedContext } from '../../../services/prompt-injection';

afterEach(() => {
  _resetMissionDbCache(project);
  closeDecisions(project);
  closeTodos(project);
  rmSync(project, { recursive: true, force: true });
});

const base = () => ({
  session: 's1',
  title: 'The reviewer never over-rejects correct code',
  criteria: ['a correct null-guard leaf is accepted', 'a real defect leaf is rejected'],
});

describe('forgeMission — atomic mission + constitution', () => {
  test('creates the mission node, criteria, active linked constraints, decision records, and digest', async () => {
    const r = await forgeMission(project, {
      ...base(),
      constraints: [
        { rule: 'the mechanical gate stays PRE-land', rationale: 'placebo-hole guarantee' },
        { rule: 'review abstains on non-falsifiable doubt over a green gate' },
      ],
      rejectedAlternatives: [
        { title: 'arbiter LLM decides contested reviews', rationale: 'Grok collapsed it', alternatives: ['route contested reviews to a second LLM judge'] },
      ],
      digest: '# Orientation\n- src/services/leaf-executor.ts — the review node + gate',
      handoffDocId: 'doc-123',
    });

    // Mission node
    const node = getTodo(project, r.missionId);
    expect(node?.kind).toBe('mission');
    expect(getMission(project, r.missionId)?.handoffDocId).toBe('doc-123');

    // Criteria
    expect(listCriteria(project, r.missionId).map((c) => c.text)).toEqual([
      'a correct null-guard leaf is accepted',
      'a real defect leaf is rejected',
    ]);

    // Constraints → ACTIVE records LINKED to the mission
    expect(r.constraints).toHaveLength(2);
    expect(r.constraints.every((c) => c.status === 'active')).toBe(true);
    expect(r.constraints.every((c) => c.linkedTodos.includes(r.missionId))).toBe(true);

    // Rejected alternatives → decision records with alternatives
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0].alternatives).toEqual(['route contested reviews to a second LLM judge']);

    // Digest written to .collab/project-digest.md
    expect(r.digestWritten).toBe(true);
    const digestPath = join(project, '.collab', 'project-digest.md');
    expect(existsSync(digestPath)).toBe(true);
    expect(readFileSync(digestPath, 'utf8')).toContain('leaf-executor.ts');
  });

  test('the forged constraints actually REACH a build node via composeInjectedContext (payload C)', async () => {
    await forgeMission(project, {
      ...base(),
      constraints: [{ rule: 'the mechanical gate stays PRE-land' }],
    });
    // A blueprint node in this project, constraints flag on → the ACTIVE CONSTRAINTS block carries the rule.
    const injected = composeInjectedContext({
      kind: 'blueprint',
      project,
      epicId: null,
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(injected).toContain('ACTIVE CONSTRAINTS');
    expect(injected).toContain('the mechanical gate stays PRE-land');
  });

  test('validates up front: no criteria and empty title both throw, nothing is created', async () => {
    await expect(forgeMission(project, { session: 's1', title: 'x', criteria: [] })).rejects.toThrow(/criteria/i);
    await expect(forgeMission(project, { session: 's1', title: '   ', criteria: ['a'] })).rejects.toThrow(/title/i);
    // No mission leaked from the failed calls.
    const missions = listDecisionRecords(project, {}); // any store touch works; assert no criteria orphaned
    expect(missions).toEqual([]);
  });
});

describe('missionConstitutionHealth — enforcement teeth', () => {
  test('forged mission WITH constraints → ok', async () => {
    const r = await forgeMission(project, { ...base(), handoffDocId: 'doc-1', constraints: [{ rule: 'X stays pre-land' }] });
    expect(missionConstitutionHealth(project, r.missionId).flag).toBe('ok');
  });

  test('mission with a handoff but NO constraints → constitution-not-injected', async () => {
    const r = await forgeMission(project, { ...base(), handoffDocId: 'doc-1' }); // handoff, zero constraints
    const h = missionConstitutionHealth(project, r.missionId);
    expect(h.hasHandoff).toBe(true);
    expect(h.linkedActiveConstraints).toBe(0);
    expect(h.flag).toBe('constitution-not-injected');
  });

  test('mission with NO handoff → ok (no constitution to enforce)', async () => {
    const r = await forgeMission(project, { ...base() }); // no handoffDocId
    expect(missionConstitutionHealth(project, r.missionId).flag).toBe('ok');
  });

  test('a PROJECT-LEVEL active constraint credits the mission (removes the hand-rolled false not-injected)', async () => {
    const { createDecisionRecord, approveDecisionRecord } = await import('../../../services/decision-record-store');
    const r = await forgeMission(project, { ...base(), handoffDocId: 'doc-1' }); // handoff, zero LINKED constraints
    expect(missionConstitutionHealth(project, r.missionId).flag).toBe('constitution-not-injected');
    // A project-level (epicId omitted → null) active constraint NOT linked to this mission. Payload C
    // injects it into every build node regardless, so the constitution DID reach the builders.
    const rec = createDecisionRecord(project, { kind: 'constraint', title: 'a project-level rule' });
    approveDecisionRecord(project, rec.id, 'ben');
    const h = missionConstitutionHealth(project, r.missionId);
    expect(h.linkedActiveConstraints).toBe(0);
    expect(h.projectActiveConstraints).toBeGreaterThan(0);
    expect(h.flag).toBe('ok');
  });
});

describe('get_mission handler resolves a short id for ALL sub-queries (not just the row)', () => {
  test('a leading-8-hex short todoId returns the SAME criteria/rollup as the full id (regression: was empty)', async () => {
    const { handleMissionTool } = await import('../../mission-tools');
    const r = await forgeMission(project, { ...base() }); // 2 criteria
    const shortId = r.missionId.slice(0, 8);
    const full = JSON.parse((await handleMissionTool('get_mission', { project, todoId: r.missionId })) as string);
    const short = JSON.parse((await handleMissionTool('get_mission', { project, todoId: shortId })) as string);
    expect(full.criteria).toHaveLength(2);
    expect(short.criteria).toHaveLength(2);            // used to be 0 — sub-queries got the raw short id
    expect(short.rollup.capability.total).toBe(2);
  });
});

describe('forgeMissionFromDoc — server forge node → unapproved mission', () => {
  const SPEC = {
    title: 'The reviewer never over-rejects correct code',
    description: 'Harden the daemon review gate.',
    criteria: ['a correct null-guard leaf is accepted', 'a real defect leaf is rejected'],
    constraints: [{ rule: 'the mechanical gate stays PRE-land', rationale: 'placebo-hole guarantee' }],
    rejectedAlternatives: [{ title: 'arbiter LLM', rationale: 'Grok killed it', alternatives: ['second LLM judge'] }],
    digest: '# Orientation\n- src/services/leaf-executor.ts — the review node',
  };
  const mockDeps = (spec: unknown = SPEC) => ({
    readDoc: async () => 'PROBLEM: the reviewer over-rejects. Design: harden the gate.',
    invoke: async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any),
  });

  test('forges an UNAPPROVED mission: status unapproved, inactive, constraints PROPOSED, handoff=docId', async () => {
    const r = await forgeMissionFromDoc(project, { session: 's1', docId: 'design-doc-1' }, mockDeps());
    const mission = getMission(project, r.missionId);
    expect(mission?.status).toBe('unapproved');
    expect(mission?.active).toBe(false);
    expect(mission?.handoffDocId).toBe('design-doc-1');
    expect(mission?.awaitingApprovalSince).not.toBe(null);
    // Constraints exist but are PROPOSED (not injecting yet).
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints.every((c) => c.status === 'proposed')).toBe(true);
    // Criteria + rejected alternatives + digest instantiated as usual.
    expect(listCriteria(project, r.missionId)).toHaveLength(2);
    expect(r.decisions).toHaveLength(1);
    expect(r.digestWritten).toBe(true);
    // Health flags it as pending human ratification (not "not-injected").
    expect(missionConstitutionHealth(project, r.missionId).flag).toBe('constitution-pending-approval');
    // The proposed constraint does NOT yet reach a build node.
    expect(composeInjectedContext({ kind: 'blueprint', project, epicId: null, flags: { digest: false, retryContext: false, activeConstraints: true } })).not.toContain('the mechanical gate stays PRE-land');
  });

  test('approve_mission ratifies it: status leaves unapproved, active, constraints go active + inject', async () => {
    const r = await forgeMissionFromDoc(project, { session: 's1', docId: 'design-doc-1' }, mockDeps());
    const { mission, approvedConstraints } = approveMissionAndConstitution(project, r.missionId, 'ben');
    expect(mission.status).not.toBe('unapproved');
    expect(mission.active).toBe(true);
    expect(approvedConstraints).toHaveLength(1);
    expect(missionConstitutionHealth(project, r.missionId).flag).toBe('ok');
    // NOW the constraint reaches a build node.
    expect(composeInjectedContext({ kind: 'blueprint', project, epicId: null, flags: { digest: false, retryContext: false, activeConstraints: true } })).toContain('the mechanical gate stays PRE-land');
  });

  test('the node model/effort default to forge (opus/high) and are returned', async () => {
    const r = await forgeMissionFromDoc(project, { session: 's1', docId: 'd' }, mockDeps());
    expect(r.modelUsed).toBe('opus');
    expect(r.effortUsed).toBe('high');
  });

  test('a node that emits no parseable spec throws (no half-forged mission)', async () => {
    await expect(
      forgeMissionFromDoc(project, { session: 's1', docId: 'd' }, {
        readDoc: async () => 'doc',
        invoke: async () => ({ ok: true, rateLimited: false, text: 'sorry, I could not do it' } as any),
      }),
    ).rejects.toThrow(/no parseable mission-spec JSON/i);
  });
});

describe('parseForgeSpec', () => {
  test('parses a fenced JSON block', () => {
    const s = parseForgeSpec('here you go:\n```json\n{"title":"T","criteria":["c1"]}\n```\ndone');
    expect(s.title).toBe('T');
    expect(s.criteria).toEqual(['c1']);
  });
  test('parses bare JSON and drops empty criteria', () => {
    const s = parseForgeSpec('{"title":"T","criteria":["a",""," "],"constraints":[{"rule":"r"}]}');
    expect(s.criteria).toEqual(['a']);
    expect(s.constraints).toEqual([{ rule: 'r' }]);
  });
  test('throws when title or criteria are missing', () => {
    expect(() => parseForgeSpec('{"criteria":["c"]}')).toThrow(/title/i);
    expect(() => parseForgeSpec('{"title":"T","criteria":[]}')).toThrow(/criteria/i);
  });
});
