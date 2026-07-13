import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { composeInjectedContext, _wrapBlock } from '../prompt-injection';
import { getInjectionFlags } from '../runtime-config';
import { createDecisionRecord, approveDecisionRecord, _closeProject } from '../decision-record-store';

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
  test('a project with no config resolves all three flags false', () => {
    const f = getInjectionFlags('/tmp/__no_such_project_injection_flags__');
    expect(f).toEqual({ digest: false, retryContext: false, activeConstraints: false });
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
