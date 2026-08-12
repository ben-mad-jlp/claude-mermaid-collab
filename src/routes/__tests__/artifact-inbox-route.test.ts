import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'artifact-inbox-route-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = dir;

mock.module('../../services/config-file.ts', () => ({
  getAuthToken: () => 'test-token-12345',
  getRequireAuthOnLoopback: () => false,
}));

import { handleArtifactInboxAPI } from '../artifact-inbox-api.js';
const { checkAuth } = await import('../../auth.js');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
});

async function post(body: unknown): Promise<Response> {
  const url = new URL('http://localhost:9002/api/artifact-inbox');
  const res = await handleArtifactInboxAPI(
    new Request(url.toString(), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    url
  );
  expect(res).not.toBeNull();
  return res!;
}

async function get(query?: string): Promise<Response> {
  const url = new URL(
    `http://localhost:9002/api/artifact-inbox${query || ''}`
  );
  const res = await handleArtifactInboxAPI(
    new Request(url.toString(), { method: 'GET' }),
    url
  );
  expect(res).not.toBeNull();
  return res!;
}

describe('POST /api/artifact-inbox', () => {
  it('round-trips a posted envelope and lists it as pending', async () => {
    const body = {
      schemaVersion: 1,
      from: {
        serverOwner: 'test-user',
        session: 'test-session',
      },
      artifact: {
        type: 'document' as const,
        name: 'test.md',
        content: 'Test content',
      },
    };

    const postRes = await post(body);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      envelopeId: string;
      receivedAt: string;
    };
    expect(postBody.envelopeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(postBody.receivedAt).toBeTruthy();

    const getRes = await get();
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      envelopes: Array<{
        envelopeId: string;
        type: string;
        name: string;
        state: string;
      }>;
    };
    expect(getBody.envelopes).toHaveLength(1);
    expect(getBody.envelopes[0].envelopeId).toBe(postBody.envelopeId);
    expect(getBody.envelopes[0].type).toBe('document');
    expect(getBody.envelopes[0].name).toBe('test.md');
    expect(getBody.envelopes[0].state).toBe('pending');
  });

  it('rejects an oversize envelope naming MAX_ENVELOPE_BYTES', async () => {
    const largeContent = 'x'.repeat(10 * 1024 * 1024 + 100);
    const body = {
      schemaVersion: 1,
      from: {},
      artifact: {
        type: 'document' as const,
        name: 'large.md',
        content: largeContent,
      },
    };

    const res = await post(body);
    expect(res.status).toBe(413);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toContain('MAX_ENVELOPE_BYTES');
  });

  it('ignores client-supplied state and envelopeId', async () => {
    const body = {
      schemaVersion: 1,
      envelopeId: 'not-a-uuid-00000000-0000-0000-0000',
      state: 'adopted' as const,
      from: {},
      artifact: {
        type: 'snippet' as const,
        name: 'test.snippet',
        content: 'Test snippet',
      },
    };

    const postRes = await post(body);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      envelopeId: string;
    };

    expect(postBody.envelopeId).not.toBe('not-a-uuid-00000000-0000-0000-0000');
    expect(postBody.envelopeId).toMatch(/^[0-9a-f-]{36}$/);

    const getRes = await get();
    const getBody = (await getRes.json()) as {
      envelopes: Array<{ envelopeId: string; state: string }>;
    };
    const envelope = getBody.envelopes.find(
      (e) => e.envelopeId === postBody.envelopeId
    );
    expect(envelope?.state).toBe('pending');
  });

  it('gates /api/artifact-inbox for a non-loopback peer', async () => {
    const url = new URL('http://localhost:9002/api/artifact-inbox');

    // Non-private peer (should get 403)
    const req1 = new Request(url.toString(), { method: 'GET' });
    const res1 = checkAuth(req1, url, '203.0.113.1');
    expect(res1).not.toBeNull();
    expect(res1!.status).toBe(403);

    // Loopback peer (should be allowed - no auth required)
    const req2 = new Request(url.toString(), { method: 'GET' });
    const res2 = checkAuth(req2, url, '127.0.0.1');
    expect(res2).toBeNull();

    // Private peer without token (should get 401)
    const req3 = new Request(url.toString(), { method: 'GET' });
    const res3 = checkAuth(req3, url, '192.168.1.50');
    expect(res3).not.toBeNull();
    expect(res3!.status).toBe(401);

    // Private peer with valid token (should be allowed)
    const req4 = new Request(url.toString(), {
      method: 'GET',
      headers: { authorization: 'Bearer test-token-12345' },
    });
    const res4 = checkAuth(req4, url, '192.168.1.50');
    expect(res4).toBeNull();
  });
});
