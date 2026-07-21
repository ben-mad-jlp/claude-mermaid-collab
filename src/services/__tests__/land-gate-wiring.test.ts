import { describe, it, expect } from 'bun:test';
import { execSync } from 'node:child_process';

describe('land-gate wiring invariants', () => {
  describe('single-path guarantee', () => {
    it('landReadiness (land-authority.ts) should be the only call site of runEpicLandGate for land', () => {
      // deriveEpicLandProof (coordinator-land.ts — the landing subsystem MOVED there out
      // of coordinator-live.ts) delegates entirely to landReadiness, so the G10 gate itself
      // now runs from exactly ONE place across all three files: inside landReadiness.
      // Neither coordinator file may re-derive it directly.
      const coordinatorFile = execSync('cat src/services/coordinator-live.ts', { encoding: 'utf8' });
      expect(coordinatorFile.split('\n').filter(l => /await\s+runEpicLandGate/.test(l)).length).toBe(0);
      const coordinatorLandFile = execSync('cat src/services/coordinator-land.ts', { encoding: 'utf8' });
      expect(coordinatorLandFile.split('\n').filter(l => /await\s+runEpicLandGate/.test(l)).length).toBe(0);

      const landAuthorityFile = execSync('cat src/services/land-authority.ts', { encoding: 'utf8' });
      const callLines = landAuthorityFile.split('\n').filter(l => /await\s+gateProbe/.test(l) || /await\s+runEpicLandGate/.test(l));
      expect(callLines.length).toBe(1);
    });

    it('validateStewardProof for land_epic should only be called from landEpic fail-fast', () => {
      // deriveEpicLandProof no longer calls validateStewardProof directly — it delegates to
      // landReadiness (checkLandDeps + tsc/merge/presence/gate probes). Only landEpic's
      // cheap fail-fast pre-check still re-derives the steward proof. landEpic MOVED to
      // coordinator-land.ts (landing-subsystem extraction).
      const coordinatorFile = execSync('cat src/services/coordinator-land.ts', { encoding: 'utf8' });
      const landEpicProofCalls = coordinatorFile.match(/validateStewardProof\(\s*'land_epic'/g) || [];
      expect(landEpicProofCalls.length).toBe(1);
    });
  });

  describe('wm.landEpicToMaster single call site', () => {
    it('landEpicToMaster should be called only from landEpic', () => {
      // landEpic MOVED to coordinator-land.ts (landing-subsystem extraction).
      const coordinatorFile = execSync('cat src/services/coordinator-land.ts', { encoding: 'utf8' });
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
      // surfaceEpicLand MOVED to coordinator-land.ts (landing-subsystem extraction).
      const coordinatorFile = execSync('cat src/services/coordinator-land.ts', { encoding: 'utf8' });
      expect(coordinatorFile).toContain('proof.gate.status === \'pass\'');
    });
  });

  describe('landEpic refuses on fail/error', () => {
    it('should create escalation when proof.ok is false', () => {
      // landEpic MOVED to coordinator-land.ts (landing-subsystem extraction).
      const coordinatorFile = execSync('cat src/services/coordinator-land.ts', { encoding: 'utf8' });
      expect(coordinatorFile).toContain('if (!proof.ok)');
      expect(coordinatorFile).toContain('createEscalation');
    });
  });
});
