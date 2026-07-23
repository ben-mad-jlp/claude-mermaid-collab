import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { escalateMainCheckoutViolation } from '../main-checkout-escalation';
import { MainCheckoutResidueError, type MainCheckoutState } from '../main-checkout-invariant';

const STATE: MainCheckoutState = { branch: 'main', sha: 'deadbeef', residue: [] };

function makeResidueError(projectRoot: string): MainCheckoutResidueError {
  return new MainCheckoutResidueError(projectRoot, 'test-op', ['?? stray-file'], STATE, STATE);
}

describe('escalation store isolation', () => {
  test('a tmpdir projectRoot never calls createEscalation', () => {
    const tmpProjectRoot = mkdtempSync(join(tmpdir(), 'wt-land-repo-'));
    const spy = { calls: [] as any[] };
    const createEscalation = ((args: any) => { spy.calls.push(args); }) as any;

    escalateMainCheckoutViolation(makeResidueError(tmpProjectRoot), { createEscalation });

    expect(spy.calls.length).toBe(0);
  });

  test('a non-tmpdir projectRoot still calls createEscalation once', () => {
    const realProjectRoot = process.cwd();
    const spy = { calls: [] as any[] };
    const createEscalation = ((args: any) => { spy.calls.push(args); }) as any;

    escalateMainCheckoutViolation(makeResidueError(realProjectRoot), { createEscalation });

    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].kind).toBe('main-checkout-residue');
  });

  test('the preload redirects MERMAID_SUPERVISOR_DIR away from the real home-dir store', () => {
    const dir = process.env.MERMAID_SUPERVISOR_DIR;
    expect(dir).toBeTruthy();
    expect(dir!.startsWith(join(homedir(), '.mermaid-collab'))).toBe(false);
  });
});
