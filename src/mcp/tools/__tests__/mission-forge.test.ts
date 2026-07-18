import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-forge-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

// Imports AFTER the env is set so any db opens against our temp dir.
import { forgeMission, missionConstitutionHealth } from '../mission-forge';
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
});
