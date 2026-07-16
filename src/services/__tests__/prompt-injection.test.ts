import { describe, expect, test, beforeEach, afterEach, afterAll } from 'bun:test';
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { composeInjectedContext, _wrapBlock } from '../prompt-injection';
import { getInjectionFlags } from '../runtime-config';
import { createDecisionRecord, approveDecisionRecord, _closeProject } from '../decision-record-store';
import { DIGEST_HEADER } from '../project-digest';

const OFF = { digest: false, retryContext: false, activeConstraints: false } as const;

describe('composeInjectedContext', () => {
  test('returns "" when all flags off — blueprint kind (appendSystemPrompt undefined proof)', () => {
    const out = composeInjectedContext({ kind: 'blueprint', project: '/x', epicId: null, flags: OFF });
    expect(out).toBe('');
    expect(out || undefined).toBeUndefined();
  });
  test('returns "" when all flags off — review kind (appendSystemPrompt undefined proof)', () => {
    const out = composeInjectedContext({ kind: 'review', project: '/x', epicId: 'e1', flags: OFF });
    expect(out).toBe('');
    expect(out || undefined).toBeUndefined();
  });
  test('_wrapBlock emits the delimited advisory markers', () => {
    const b = _wrapBlock('PROJECT DIGEST', 'body');
    expect(b).toContain('=== PROJECT DIGEST (advisory — verify against the tree) ===');
    expect(b).toContain('=== end PROJECT DIGEST ===');
  });
});

describe('source-guard: single assembly site', () => {
  test('the advisory block marker literal appears in exactly one non-test src file', () => {
    const MARKER = 'advisory — verify against the tree';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (e !== '__tests__' && e !== 'node_modules') walk(p); continue; }
        if (!p.endsWith('.ts') || p.endsWith('.test.ts')) continue;
        if (readFileSync(p, 'utf8').includes(MARKER)) hits.push(p);
      }
    };
    walk(join(import.meta.dir, '..', '..')); // src/
    expect(hits.length).toBe(1);
    expect(hits[0].endsWith('services/prompt-injection.ts')).toBe(true);
  });
});

describe('getInjectionFlags', () => {
  test('a project with no config defaults ALL THREE flags ON (every payload is self-gating)', () => {
    const f = getInjectionFlags('/tmp/__no_such_project_injection_flags__');
    expect(f).toEqual({ digest: true, retryContext: true, activeConstraints: true });
  });
});

describe('payload B — PREVIOUS ATTEMPT FAILED', () => {
  test('attempt 1 (first attempt) ⇒ no retry block', () => {
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 1,
      priorRun: { terminal: { reason: 'some failure', gateReasons: [] }, reviewVerdict: 'fail' },
    });
    expect(out).toBe('');
  });

  test('priorRun undefined ⇒ no retry block', () => {
    const out = composeInjectedContext({
      kind: 'implement',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 2,
      priorRun: null,
    });
    expect(out).toBe('');
  });

  test('retryContext flag OFF ⇒ no retry block even on attempt>1', () => {
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: false, activeConstraints: false },
      attempt: 2,
      priorRun: { terminal: { reason: 'prior failed', gateReasons: [] }, reviewVerdict: 'fail' },
    });
    expect(out).toBe('');
  });

  test('populated + verbatim + marker block (blueprint kind)', () => {
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 2,
      priorRun: {
        terminal: { reason: 'compile failed', gateReasons: ['syntax error', 'type mismatch'] },
        reviewVerdict: 'fail',
        finalOutcome: 'rejected',
      },
    });
    expect(out).toContain('=== PREVIOUS ATTEMPT FAILED (advisory — verify against the tree) ===');
    expect(out).toContain('compile failed');
    expect(out).toContain('syntax error');
    expect(out).toContain('type mismatch');
    expect(out).toContain('review verdict: fail');
  });

  test('over-long reason ⇒ capped + truncation marker', () => {
    const longReason = 'a'.repeat(2500) + 'END_SENTINEL';
    const out = composeInjectedContext({
      kind: 'implement',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 2,
      priorRun: {
        terminal: { reason: longReason, gateReasons: [] },
        reviewVerdict: null,
      },
    });
    expect(out).toContain('=== PREVIOUS ATTEMPT FAILED (advisory — verify against the tree) ===');
    expect(out).toContain('…[truncated');
    expect(out).not.toContain('END_SENTINEL');
    expect(out.length).toBeLessThan(longReason.length);
  });

  test('review kind is excluded (not a retry kind)', () => {
    const out = composeInjectedContext({
      kind: 'review',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 2,
      priorRun: { terminal: { reason: 'prior failed' }, reviewVerdict: 'fail' },
    });
    expect(out).toBe('');
  });

  test('priorRunFailed false (no failure indicators) ⇒ no block', () => {
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: 'e1',
      flags: { digest: false, retryContext: true, activeConstraints: false },
      attempt: 2,
      priorRun: { terminal: { reason: '', gateReasons: [] }, reviewVerdict: 'pass', finalOutcome: 'accepted' },
    });
    expect(out).toBe('');
  });
});

describe('payload C — ACTIVE CONSTRAINTS', () => {
  let project: string;
  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'prompt-inject-')); });
  afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

  test('flag off ⇒ empty (constraints present)', () => {
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'no cross-epic imports', epicId: 'X' });
    approveDecisionRecord(project, c.id, 'h');
    const out = composeInjectedContext({
      kind: 'implement',
      project,
      epicId: 'X',
      flags: { digest: false, retryContext: false, activeConstraints: false },
    });
    expect(out).toBe('');
  });

  test('flag on + constraint present ⇒ populated block (build path)', () => {
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'no cross-epic imports', epicId: 'X' });
    approveDecisionRecord(project, c.id, 'h');
    const out = composeInjectedContext({
      kind: 'implement',
      project,
      epicId: 'X',
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(out).toContain('=== ACTIVE CONSTRAINTS (advisory — verify against the tree) ===');
    expect(out).toContain(c.id);
    expect(out).toContain('no cross-epic imports');
    expect(out).not.toBe('');
  });

  test('flag on + constraint present ⇒ populated block (review path)', () => {
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'no cross-epic imports', epicId: 'X' });
    approveDecisionRecord(project, c.id, 'h');
    const out = composeInjectedContext({
      kind: 'review',
      project,
      epicId: 'X',
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(out).toContain('=== ACTIVE CONSTRAINTS (advisory — verify against the tree) ===');
    expect(out).toContain(c.id);
    expect(out).toContain('no cross-epic imports');
    expect(out).not.toBe('');
  });

  test('flag on but no active constraints ⇒ empty', () => {
    createDecisionRecord(project, { kind: 'constraint', title: 'proposed only', epicId: 'X' });
    const out = composeInjectedContext({
      kind: 'implement',
      project,
      epicId: 'X',
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(out).toBe('');
  });
});

describe('payload A — PROJECT DIGEST', () => {
  test('flags.digest=true, kind=blueprint, digest present ⇒ contains digest header + delimited block', () => {
    const stubDigest = DIGEST_HEADER + '\n\n## Where things live\n- `src/` — backend';
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: null,
      flags: { digest: true, retryContext: false, activeConstraints: false },
      readDigest: () => stubDigest,
    });
    expect(out).toContain('orientation hints — VERIFY against the tree');
    expect(out).toContain('=== PROJECT DIGEST (advisory — verify against the tree) ===');
  });

  test('flags.digest=true, kind=research, digest present ⇒ contains digest header', () => {
    const stubDigest = DIGEST_HEADER + '\n\n## Where things live\n- `src/` — backend';
    const out = composeInjectedContext({
      kind: 'research',
      project: '/x',
      epicId: null,
      flags: { digest: true, retryContext: false, activeConstraints: false },
      readDigest: () => stubDigest,
    });
    expect(out).toContain('orientation hints — VERIFY against the tree');
  });

  test('flags.digest=true, kind=implement, digest present ⇒ does NOT contain digest (v1 scope excludes implement)', () => {
    const stubDigest = DIGEST_HEADER + '\n\n## Where things live\n- `src/` — backend';
    const out = composeInjectedContext({
      kind: 'implement',
      project: '/x',
      epicId: null,
      flags: { digest: true, retryContext: false, activeConstraints: false },
      readDigest: () => stubDigest,
    });
    expect(out).toBe('');
  });

  test('flags.digest=false, kind=blueprint, digest present ⇒ empty', () => {
    const stubDigest = DIGEST_HEADER + '\n\n## Where things live\n- `src/` — backend';
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: null,
      flags: { digest: false, retryContext: false, activeConstraints: false },
      readDigest: () => stubDigest,
    });
    expect(out).toBe('');
  });

  test('flags.digest=true, kind=blueprint, reader returns null ⇒ empty', () => {
    const out = composeInjectedContext({
      kind: 'blueprint',
      project: '/x',
      epicId: null,
      flags: { digest: true, retryContext: false, activeConstraints: false },
      readDigest: () => null,
    });
    expect(out).toBe('');
  });
});


// Local helper for the appended mission-forge wiring tests (mirrors the beforeEach pattern).
const _forgeDirs: string[] = [];
function mkProject(): string {
  const d = mkdtempSync(join(tmpdir(), 'prompt-inject-forge-'));
  _forgeDirs.push(d);
  return d;
}
afterAll(() => { for (const d of _forgeDirs) { try { _closeProject(d); rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

describe('payload C — blueprint kind (mission-forge wiring)', () => {
  test('blueprint now receives ACTIVE CONSTRAINTS (the plan author needs them most)', () => {
    const project = mkProject();
    const c = createDecisionRecord(project, { kind: 'constraint', title: 'mechanical gate stays pre-land', epicId: null });
    approveDecisionRecord(project, c.id, 'h');
    const out = composeInjectedContext({
      kind: 'blueprint',
      project,
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(out).toContain('=== ACTIVE CONSTRAINTS (advisory — verify against the tree) ===');
    expect(out).toContain('mechanical gate stays pre-land');
  });
});

describe('payload D — REJECTED ALTERNATIVES', () => {
  test('active decision with alternatives reaches blueprint; implement excluded; no-alts decision emits nothing', () => {
    const project = mkProject();
    createDecisionRecord(project, {
      kind: 'decision',
      title: 'grounding gate keeps per-criterion teeth',
      alternatives: ['whole-review-only grounding (vacuous-PASS hole)', 'blanket abstain on empty change-set'],
    });
    const bp = composeInjectedContext({
      kind: 'blueprint',
      project,
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(bp).toContain('REJECTED ALTERNATIVES (do not re-propose)');
    expect(bp).toContain('whole-review-only grounding');
    const impl = composeInjectedContext({
      kind: 'implement',
      project,
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(impl).not.toContain('REJECTED ALTERNATIVES');

    const project2 = mkProject();
    createDecisionRecord(project2, { kind: 'decision', title: 'no alternatives recorded' });
    const out2 = composeInjectedContext({
      kind: 'blueprint',
      project: project2,
      flags: { digest: false, retryContext: false, activeConstraints: true },
    });
    expect(out2).not.toContain('REJECTED ALTERNATIVES');
  });

  test('flag off ⇒ no payload D', () => {
    const project = mkProject();
    createDecisionRecord(project, { kind: 'decision', title: 't', alternatives: ['x'] });
    const out = composeInjectedContext({
      kind: 'blueprint',
      project,
      flags: { digest: false, retryContext: false, activeConstraints: false },
    });
    expect(out).toBe('');
  });
});
