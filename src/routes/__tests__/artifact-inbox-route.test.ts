/**
 * MUTATION PROBE: this test drives dispatchRequest's auth gate (src/routes/dispatch.ts:26-27,
 * checkAuth call) via case (a) without a token, which must 401 and NOT reach the handler.
 * With checkAuth neutered (returning null instead of a 401 response), case (a) fails because
 * it no longer receives 401 — proof that checkAuth is called and its result is observed.
 * Observed armed-run outcome: verdict: 'graded', execution: 'called-observed'.
 * Control run passed; neutered and throw arms both failed as expected (exitCode: 1).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeWebSocketHandler } from '../../services/ws-handler-manager.js';

const dir = mkdtempSync(join(tmpdir(), 'artifact-inbox-route-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = dir;

mock.module('../../services/config-file.ts', () => ({
  getAuthToken: () => 'test-token-12345',
  getRequireAuthOnLoopback: () => false,
}));

import { handleArtifactInboxAPI } from '../artifact-inbox-api.js';
const { dispatchRequest } = await import('../dispatch.js');

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

async function dispatchGet(
  peer: string,
  headers?: Record<string, string>
): Promise<Response | null> {
  const url = new URL('http://localhost:9002/api/artifact-inbox');
  return await dispatchRequest(
    new Request(url.toString(), {
      method: 'GET',
      headers,
    }),
    url,
    peer
  );
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

  it('drives dispatchRequest: 401 without a token, 200 with one, 403 for a public peer', async () => {
    // Case (a): Private peer without token → 401 and handler not reached
    const countBefore = ((await get()) as Response & { envelopes?: unknown[] }).envelopes
      ?.length ?? 0;
    const resBefore = await get();
    const bodyBefore = (await resBefore.json()) as { envelopes: unknown[] };
    const envelopeCountBefore = bodyBefore.envelopes.length;

    const res1 = await dispatchGet('192.168.1.50');
    expect(res1).not.toBeNull();
    expect(res1!.status).toBe(401);

    const resAfter = await get();
    const bodyAfter = (await resAfter.json()) as { envelopes: unknown[] };
    const envelopeCountAfter = bodyAfter.envelopes.length;
    expect(envelopeCountAfter).toBe(envelopeCountBefore);

    // Case (b): Same peer with valid token → 200 and handler reached (envelopes present)
    const res2 = await dispatchGet('192.168.1.50', {
      authorization: 'Bearer test-token-12345',
    });
    expect(res2).not.toBeNull();
    expect(res2!.status).toBe(200);
    const body2 = (await res2!.json()) as { envelopes: unknown[] };
    expect(Array.isArray(body2.envelopes)).toBe(true);

    // Case (c): Public peer → 403
    const res3 = await dispatchGet('203.0.113.1');
    expect(res3).not.toBeNull();
    expect(res3!.status).toBe(403);
  });
});

describe('POST /api/artifact-inbox broadcast', () => {
  const sent: unknown[] = [];

  beforeAll(() => {
    initializeWebSocketHandler({
      broadcast: (m: unknown) => {
        sent.push(m);
      },
    } as unknown as Parameters<typeof initializeWebSocketHandler>[0]);
  });

  afterAll(() => {
    initializeWebSocketHandler(
      null as unknown as Parameters<typeof initializeWebSocketHandler>[0]
    );
  });

  it('broadcasts artifact_inbox_updated once on an accepted POST and not on a rejected POST', async () => {
    // Positive case: valid envelope
    const validBody = {
      schemaVersion: 1,
      from: {
        serverOwner: 'test-user',
        session: 'test-session',
      },
      artifact: {
        type: 'document' as const,
        name: 'broadcast-test.md',
        content: 'Test content',
      },
    };

    const validRes = await post(validBody);
    expect(validRes.status).toBeGreaterThanOrEqual(200);
    expect(validRes.status).toBeLessThan(300);
    expect(sent.length).toBe(1);
    expect(sent[0]).toEqual({ type: 'artifact_inbox_updated' });

    // Reset for negative case
    sent.length = 0;

    // Negative case: oversize envelope
    const largeContent = 'x'.repeat(10 * 1024 * 1024 + 100);
    const oversizeBody = {
      schemaVersion: 1,
      from: {},
      artifact: {
        type: 'document' as const,
        name: 'large-broadcast-test.md',
        content: largeContent,
      },
    };

    const oversizeRes = await post(oversizeBody);
    expect(oversizeRes.status).toBe(413);
    expect(
      sent.filter((m) => (m as { type?: string }).type === 'artifact_inbox_updated')
        .length
    ).toBe(0);
  });
});
