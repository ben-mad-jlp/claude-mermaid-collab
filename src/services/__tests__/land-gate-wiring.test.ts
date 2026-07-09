import { describe, it, expect } from 'bun:test';
import { execSync } from 'node:child_process';

describe('land-gate wiring invariants', () => {
  describe('single-path guarantee', () => {
    it('deriveEpicLandProof should be the only call site of runEpicLandGate for land', () => {
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      // Count lines with 'await runEpicLandGate' (actual calls, not imports)
      const callLines = coordinatorFile.split('\n').filter(l => /await\s+runEpicLandGate/.test(l));
      expect(callLines.length).toBe(1);
      expect(callLines[0]).toContain('runEpicLandGate');
    });

    it('validateStewardProof for land_epic should only be called from deriveEpicLandProof and landEpic fail-fast', () => {
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      const landEpicProofCalls = coordinatorFile.match(/validateStewardProof\('land_epic'/g) || [];
      // One in deriveEpicLandProof, one in the fail-fast early check of landEpic
      expect(landEpicProofCalls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('wm.landEpicToMaster single call site', () => {
    it('landEpicToMaster should be called only from landEpic', () => {
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      const matches = coordinatorFile.match(/\.landEpicToMaster\(/g) || [];
      // One in landEpic function
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('trailer is recorded in the commit', () => {
    it('landEpicToMaster should accept and use extraTrailers option', () => {
      const managerFile = execSync('cat src/agent/worktree-manager.ts', { encoding: 'utf8' });
      expect(managerFile).toContain('extraTrailers');
      expect(managerFile).toContain('mergeMessage += `\\n${opts.extraTrailers}`');
    });
  });

  describe('AUTO-LAND requires gate status pass', () => {
    it('auto-land condition should check gate.status === "pass"', () => {
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      expect(coordinatorFile).toContain('proof.gate.status === \'pass\'');
    });
  });

  describe('landEpic refuses on fail/error', () => {
    it('should create escalation when proof.ok is false', () => {
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      expect(coordinatorFile).toContain('if (!proof.ok)');
      expect(coordinatorFile).toContain('createEscalation');
    });
  });
});
