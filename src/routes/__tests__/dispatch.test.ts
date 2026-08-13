import { describe, it, expect, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'dispatch-test-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = dir;

mock.module('../../services/config-file.ts', () => ({
  getAuthToken: () => 'test-token-12345',
  getRequireAuthOnLoopback: () => false,
}));

const { dispatchRequest } = await import('../dispatch.js');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
});

describe('dispatchRequest', () => {
  it('dispatchRequest returns 403 for a non-loopback peer', async () => {
    const url = new URL('http://localhost:9002/api/test');
    const req = new Request(url.toString(), { method: 'GET' });
    const res = await dispatchRequest(req, url, '203.0.113.1');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('dispatchRequest returns null for an unmatched pathname on a loopback peer', async () => {
    const url = new URL('http://localhost:9002/api/supervisor/health');
    const req = new Request(url.toString(), { method: 'GET' });
    const res = await dispatchRequest(req, url, '127.0.0.1');

    expect(res).toBeNull();
  });

  it('dispatchRequest serves a loopback GET /api/artifact-inbox with status 200', async () => {
    const url = new URL('http://localhost:9002/api/artifact-inbox');
    const req = new Request(url.toString(), { method: 'GET' });
    const res = await dispatchRequest(req, url, '127.0.0.1');

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });
});
