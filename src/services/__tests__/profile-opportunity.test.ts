import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  signatureForFiles,
  hasMatchingPack,
  recordGeneralRouting,
  detectOpportunities,
  pollNewOpportunities,
  clearEmitted,
  listSignals,
  generalOveruseThreshold,
  DEFAULT_GENERAL_OVERUSE_THRESHOLD,
} from '../profile-opportunity';

let project: string;
const ENV = 'MERMAID_GENERAL_OVERUSE_THRESHOLD';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'profopp-'));
  delete process.env[ENV];
});
afterEach(() => {
  delete process.env[ENV];
  rmSync(project, { recursive: true, force: true });
});

/** Record N distinct todos all carrying the same files. */
async function recordN(n: number, files: string[]): Promise<void> {
  for (let i = 0; i < n; i++) {
    await recordGeneralRouting(project, { todoId: `t${i}`, files, session: 'general-1' });
  }
}

describe('threshold', () => {
  it('defaults to the conservative constant', () => {
    expect(generalOveruseThreshold()).toBe(DEFAULT_GENERAL_OVERUSE_THRESHOLD);
  });
  it('honours a valid env override', () => {
    process.env[ENV] = '2';
    expect(generalOveruseThreshold()).toBe(2);
  });
  it('ignores a bad / zero / negative env value', () => {
    for (const bad of ['0', '-3', 'abc', '1.5', '']) {
      process.env[ENV] = bad;
      expect(generalOveruseThreshold()).toBe(DEFAULT_GENERAL_OVERUSE_THRESHOLD);
    }
  });
});

describe('signature derivation', () => {
  it('keys on sorted extensions when present', () => {
    expect(signatureForFiles(['parts/a.step', 'parts/b.parts']).key).toBe('parts,step');
    expect(signatureForFiles(['x.step']).exts).toEqual(['step']);
    expect(signatureForFiles(['parts/a.step']).dirs).toEqual(['parts']);
  });
  it('falls back to a dir key for extensionless files', () => {
    expect(signatureForFiles(['bin/Dockerfile', 'bin/Makefile']).key).toBe('dir:bin');
  });
});

describe('hasMatchingPack', () => {
  it('is false for files no routing rule covers', () => {
    expect(hasMatchingPack(project, ['frob/a.frobx'])).toBe(false);
  });
  it('is true when a global PATH_RULE covers them', () => {
    expect(hasMatchingPack(project, ['ui/Button.tsx'])).toBe(true);
  });
});

describe('accumulator', () => {
  it('records general-routed todos and captures their patterns', async () => {
    const s = await recordGeneralRouting(project, { todoId: 't1', files: ['frob/a.frobx'] });
    expect(s?.key).toBe('frobx');
    expect(s?.files).toEqual(['frob/a.frobx']);
    expect(listSignals(project)).toHaveLength(1);
  });
  it('dedups by todoId (a re-claim does not inflate the cluster)', async () => {
    await recordGeneralRouting(project, { todoId: 'same', files: ['frob/a.frobx'] });
    await recordGeneralRouting(project, { todoId: 'same', files: ['frob/a.frobx'] });
    expect(listSignals(project)).toHaveLength(1);
  });
  it('ignores events with no files', async () => {
    expect(await recordGeneralRouting(project, { todoId: 't', files: [] })).toBeNull();
    expect(await recordGeneralRouting(project, { todoId: 't', files: null })).toBeNull();
    expect(listSignals(project)).toHaveLength(0);
  });
});

describe('threshold signal', () => {
  it('emits nothing below the threshold', async () => {
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD - 1, ['frob/a.frobx']);
    expect(detectOpportunities(project)).toHaveLength(0);
  });
  it('emits a cluster at/above the threshold', async () => {
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD, ['frob/a.frobx']);
    const opps = detectOpportunities(project);
    expect(opps).toHaveLength(1);
    expect(opps[0].key).toBe('frobx');
    expect(opps[0].todoIds.length).toBe(DEFAULT_GENERAL_OVERUSE_THRESHOLD);
    expect(opps[0].sampleFiles).toContain('frob/a.frobx');
  });
  it('respects an env-lowered threshold', async () => {
    process.env[ENV] = '2';
    await recordN(2, ['frob/a.frobx']);
    expect(detectOpportunities(project)).toHaveLength(1);
  });
  it('does NOT emit a cluster a routing rule already covers', async () => {
    // .tsx under ui/ infers a concrete (non-general) type → covered, not a gap.
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD + 1, ['ui/Widget.tsx']);
    expect(detectOpportunities(project)).toHaveLength(0);
  });
});

describe('deduped signal (pollNewOpportunities)', () => {
  it('fires a qualifying cluster exactly once, then suppresses it', async () => {
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD, ['frob/a.frobx']);
    const first = await pollNewOpportunities(project);
    expect(first.map((o) => o.key)).toEqual(['frobx']);
    const second = await pollNewOpportunities(project);
    expect(second).toHaveLength(0);
  });
  it('re-fires after the emitted mark is cleared', async () => {
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD, ['frob/a.frobx']);
    await pollNewOpportunities(project);
    await clearEmitted(project, 'frobx');
    const again = await pollNewOpportunities(project);
    expect(again.map((o) => o.key)).toEqual(['frobx']);
  });
  it('still surfaces a NEW distinct cluster while an old one stays suppressed', async () => {
    await recordN(DEFAULT_GENERAL_OVERUSE_THRESHOLD, ['frob/a.frobx']);
    expect(await pollNewOpportunities(project)).toHaveLength(1);
    // A second, different-signature cluster appears.
    for (let i = 0; i < DEFAULT_GENERAL_OVERUSE_THRESHOLD; i++) {
      await recordGeneralRouting(project, { todoId: `g${i}`, files: ['gizmo/x.giz'] });
    }
    const next = await pollNewOpportunities(project);
    expect(next.map((o) => o.key)).toEqual(['giz']);
  });
});
