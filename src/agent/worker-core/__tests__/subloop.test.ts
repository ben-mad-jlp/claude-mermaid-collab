import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { spawnSubloop, tolerantJsonParse } from '../subloop';
import { VerifyVerdictSchema } from '../schemas';

function mockModel(text: string) {
  // Minimal static generate result; cast keeps the test mock free of the V3 result's
  // optional telemetry fields (scaffolding only — runtime maps content → text).
  return new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }) as any,
  });
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-subloop-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('tolerantJsonParse', () => {
  it('extracts JSON from a fenced block surrounded by prose', () => {
    const r = tolerantJsonParse('Here you go:\n```json\n{"pass": true}\n```\nthanks');
    expect(r).toEqual({ ok: true, value: { pass: true } });
  });
  it('reports failure when no JSON object is present', () => {
    expect(tolerantJsonParse('no json here')).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('spawnSubloop', () => {
  it('returns the model text for a plain (no-schema) phase', async () => {
    const res = await spawnSubloop({ cwd, model: mockModel('implemented it') }, 'implement', 'do the thing');
    expect(res.text).toBe('implemented it');
    expect(res.object).toBeUndefined();
  });

  it('parses + validates a typed verdict against its schema', async () => {
    const json = '{"pass": true, "failingChecks": [], "errorSignatures": []}';
    const res = await spawnSubloop(
      { cwd, model: mockModel(json) },
      'verify',
      'verify the change',
      { schema: VerifyVerdictSchema },
    );
    expect(res.parseError).toBeUndefined();
    expect(res.object).toEqual({ pass: true, failingChecks: [], errorSignatures: [] });
  });

  it('FAIL-SAFE: a malformed verdict sets parseError and leaves object undefined', async () => {
    const res = await spawnSubloop(
      { cwd, model: mockModel('the tests passed, trust me') },
      'verify',
      'verify the change',
      { schema: VerifyVerdictSchema },
    );
    expect(res.object).toBeUndefined();
    expect(res.parseError).toBeTruthy();
  });
});
