import { describe, it, expect } from 'bun:test';
import { formatGateErrorReason } from '../leaf-executor';
import type { LeafGateResult } from '../leaf-gate';

describe('formatGateErrorReason', () => {
  it('carries the reasons when the error is a misconfigured declaration (command undefined, output empty)', () => {
    // Exactly the shape gateResultForDeclaration returns: no command, empty output, the
    // explanation lives ONLY in reasons. Today this produced the opaque `gate-could-not-run: gate — `.
    const mech: LeafGateResult = {
      status: 'error',
      output: '',
      reasons: ['gate misconfigured: gate must be an object (.collab/project.json)'],
      declared: false,
    };
    const reason = formatGateErrorReason(mech);
    expect(reason).toContain('gate misconfigured: gate must be an object');
    // The whole point: it is NOT the empty opaque string anymore.
    expect(reason).not.toBe('gate-could-not-run: gate — ');
  });

  it('does not regress the legible command+output shape when there are no reasons', () => {
    const mech: LeafGateResult = {
      status: 'error',
      command: 'npx tsc --noEmit',
      output: 'error TS1005: ; expected',
      reasons: [],
      declared: true,
    };
    const reason = formatGateErrorReason(mech);
    expect(reason).toContain('npx tsc --noEmit');
    expect(reason).toContain('error TS1005');
  });

  it('includes both the command and the reasons when both are present', () => {
    const mech: LeafGateResult = {
      status: 'error',
      command: 'bun test',
      output: 'boom',
      reasons: ['gate could not run: bun test'],
      declared: true,
    };
    const reason = formatGateErrorReason(mech);
    expect(reason).toContain('bun test');
    expect(reason).toContain('gate could not run: bun test');
  });
});
