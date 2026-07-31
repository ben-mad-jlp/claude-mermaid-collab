import { describe, test, expect } from 'bun:test';
import { buildCloseOutBrief, runTestOnlyCloseArm, type CloseArmDeps } from '../conductor-test-only-close-arm';

describe('buildCloseOutBrief', () => {
  test('embeds TO CLOSE text verbatim and an OUT OF SCOPE block naming src/**+ui/src/**, without testPaths inside it', () => {
    const brief = buildCloseOutBrief({
      criterionText: 'p95 latency measured under 100ms',
      toCloseText: 'TO CLOSE\nthe assertion at src/__tests__/perf.test.ts:12 is stale, update the threshold',
      testPaths: ['src/__tests__/perf.test.ts'],
      verifiedAtSha: 'deadbeef1234',
    });

    expect(brief.description).toContain('TO CLOSE');
    expect(brief.description).toContain('the assertion at src/__tests__/perf.test.ts:12 is stale, update the threshold');
    expect(brief.description).toContain('OUT OF SCOPE');
    expect(brief.description).toContain('src/*');
    expect(brief.description).toContain('ui/src/**');
    expect(brief.outOfScope).toEqual(['src/*', 'ui/src/**', 'bin/**', 'scripts/**']);

    const outOfScopeBlock = brief.description.slice(brief.description.indexOf('OUT OF SCOPE'));
    expect(outOfScopeBlock).not.toContain('src/__tests__/perf.test.ts');

    expect(brief.files).toEqual(['src/__tests__/perf.test.ts']);
    expect(brief.title).toContain('p95 latency measured under 100ms');
  });

  test('no outOfScope glob matches any testPath file (real Bun.Glob check)', () => {
    const brief = buildCloseOutBrief({
      criterionText: 'a thing',
      toCloseText: null,
      testPaths: ['src/__tests__/perf.test.ts', 'src/services/__tests__/foo.test.ts'],
      verifiedAtSha: null,
    });

    for (const g of brief.outOfScope) {
      for (const f of brief.files) {
        expect(new Bun.Glob(g).match(f)).toBe(false);
      }
    }
    expect(brief.outOfScope.some((g) => g.startsWith('src/'))).toBe(true);
  });

  test('falls back to "(none captured)" when toCloseText is null', () => {
    const brief = buildCloseOutBrief({
      criterionText: 'a thing',
      toCloseText: null,
      testPaths: [],
      verifiedAtSha: null,
    });
    expect(brief.description).toContain('(none captured)');
    expect(brief.description).not.toContain('Verdict verified at sha');
  });

  test('cites verifiedAtSha when present', () => {
    const brief = buildCloseOutBrief({
      criterionText: 'a thing',
      toCloseText: null,
      testPaths: [],
      verifiedAtSha: 'cafebabe',
    });
    expect(brief.description).toContain('cafebabe');
  });
});

function baseCriterion(overrides: Partial<Parameters<typeof runTestOnlyCloseArm>[3]> = {}) {
  return {
    id: 'crit-1',
    text: 'p95 latency measured under 100ms',
    evidence: 'measured at src/__tests__/perf.test.ts:12',
    evidencePaths: ['src/__tests__/perf.test.ts'],
    verifiedAtSha: 'deadbeef1234',
    ...overrides,
  };
}

describe('runTestOnlyCloseArm', () => {
  test('why: not-test-only when the verdict cites a product path', async () => {
    const deps: CloseArmDeps = {
      classifyVerdictTestOnly: () => ({ testOnly: false, testPaths: [], nonTestPaths: ['src/foo.ts'], reason: 'product-path-cited' }),
    };
    const r = await runTestOnlyCloseArm('proj', 's1', 'mission-1', baseCriterion(), deps);
    expect(r).toEqual({ minted: false, why: 'not-test-only' });
  });

  test('why: already-claimed when the rung claim fails (double-claim race)', async () => {
    const deps: CloseArmDeps = {
      classifyVerdictTestOnly: () => ({ testOnly: true, testPaths: ['src/__tests__/perf.test.ts'], nonTestPaths: [], reason: 'all-cited-paths-are-tests' }),
      claimApproachRungOnce: () => false,
    };
    const r = await runTestOnlyCloseArm('proj', 's1', 'mission-1', baseCriterion(), deps);
    expect(r).toEqual({ minted: false, why: 'already-claimed' });
  });

  test('why: mint-failed when createEpicWithLandLeaf throws after a successful claim', async () => {
    const deps: CloseArmDeps = {
      classifyVerdictTestOnly: () => ({ testOnly: true, testPaths: ['src/__tests__/perf.test.ts'], nonTestPaths: [], reason: 'all-cited-paths-are-tests' }),
      claimApproachRungOnce: () => true,
      createEpicWithLandLeaf: async () => { throw new Error('boom'); },
    };
    const r = await runTestOnlyCloseArm('proj', 's1', 'mission-1', baseCriterion(), deps);
    expect(r).toEqual({ minted: false, why: 'mint-failed' });
  });

  test('why: mint-failed when addLeavesToEpic throws (after the epic was released)', async () => {
    const approvedCalls: any[] = [];
    const deps: CloseArmDeps = {
      classifyVerdictTestOnly: () => ({ testOnly: true, testPaths: ['src/__tests__/perf.test.ts'], nonTestPaths: [], reason: 'all-cited-paths-are-tests' }),
      claimApproachRungOnce: () => true,
      createEpicWithLandLeaf: async () => ({ epic: { id: 'epic-1' } }),
      updateTodo: (async (project: string, id: string, patch: any) => {
        approvedCalls.push({ project, id, patch });
        return {} as any;
      }) as any,
      addLeavesToEpic: async () => { throw new Error('boom'); },
    };
    const r = await runTestOnlyCloseArm('proj', 's1', 'mission-1', baseCriterion(), deps);
    expect(r).toEqual({ minted: false, why: 'mint-failed' });
    expect(approvedCalls.length).toBe(1);
    expect(approvedCalls[0].patch.approvedAt).toBeTruthy();
  });

  test('why: minted — claims, releases the epic BEFORE adding leaves, and returns epicId/leafId', async () => {
    const calls: string[] = [];
    const deps: CloseArmDeps = {
      classifyVerdictTestOnly: () => ({ testOnly: true, testPaths: ['src/__tests__/perf.test.ts'], nonTestPaths: [], reason: 'all-cited-paths-are-tests' }),
      claimApproachRungOnce: () => true,
      createEpicWithLandLeaf: async () => { calls.push('create'); return { epic: { id: 'epic-1' } }; },
      updateTodo: (async (project: string, id: string, patch: any) => {
        calls.push('release');
        expect(patch.approvedAt).toBeTruthy();
        return {} as any;
      }) as any,
      addLeavesToEpic: async () => { calls.push('addLeaves'); return { epicId: 'epic-1', createdIds: ['leaf-1'] }; },
    };
    const r = await runTestOnlyCloseArm('proj', 's1', 'mission-1', baseCriterion(), deps);
    expect(r).toEqual({ minted: true, why: 'minted', epicId: 'epic-1', leafId: 'leaf-1' });
    expect(calls).toEqual(['create', 'release', 'addLeaves']);
  });
});
