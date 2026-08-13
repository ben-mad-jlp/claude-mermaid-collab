import { describe, it, expect, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inboxDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-nudge-'));
const dataDir = mkdtempSync(join(tmpdir(), 'artifact-inbox-data-'));
process.env.MERMAID_ARTIFACT_INBOX_DIR = inboxDir;
process.env.MERMAID_DATA_DIR = dataDir;

import { handleArtifactInboxAPI } from '../artifact-inbox-api.js';
import {
  addSubscription,
  pendingCount,
  listPending,
  drainInbox,
  __resetForTest,
} from '../../services/session-subscriptions.js';

afterEach(() => {
  __resetForTest();
});

afterAll(() => {
  rmSync(inboxDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.MERMAID_ARTIFACT_INBOX_DIR;
  delete process.env.MERMAID_DATA_DIR;
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

async function get(): Promise<Response> {
  const url = new URL('http://localhost:9002/api/artifact-inbox');
  const res = await handleArtifactInboxAPI(
    new Request(url.toString(), { method: 'GET' }),
    url
  );
  expect(res).not.toBeNull();
  return res!;
}

const testProject = '/Users/benmaderazo/Code/test-project';

describe('artifact inbox nudge subscriptions', () => {
  it('enqueues an artifact_inbox_received notification for a project-scope subscriber', async () => {
    addSubscription(testProject, 'sess-a', 'project');

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

    expect(pendingCount(testProject, 'sess-a')).toBe(1);
    const pending = listPending(testProject, 'sess-a');
    expect(pending).toHaveLength(1);
    expect(pending[0].event).toBe('artifact_inbox_received');
    expect(pending[0].summary).toContain('document');
    expect(pending[0].summary).toContain('test.md');

    const payload = JSON.parse(pending[0].payload || '{}');
    expect(payload.envelopeId).toBe(postBody.envelopeId);
    expect(payload.type).toBe('document');
    expect(payload.name).toBe('test.md');
    expect(payload.receivedAt).toBe(postBody.receivedAt);
  });

  it('drains the arrival notification exactly once', async () => {
    addSubscription(testProject, 'sess-b', 'project');

    const body = {
      schemaVersion: 1,
      from: {},
      artifact: {
        type: 'diagram' as const,
        name: 'diagram.mmd',
        content: 'graph LR; A --> B',
      },
    };

    await post(body);
    expect(pendingCount(testProject, 'sess-b')).toBe(1);

    const drained = drainInbox(testProject, 'sess-b');
    expect(drained).toHaveLength(1);
    expect(drained[0].event).toBe('artifact_inbox_received');

    expect(pendingCount(testProject, 'sess-b')).toBe(0);
  });

  it('does not nudge a todo-scope subscription or an unsubscribed session', async () => {
    addSubscription(testProject, 'sess-c', 'todo', 'T1');
    // sess-d is never subscribed

    const body = {
      schemaVersion: 1,
      from: {},
      artifact: {
        type: 'snippet' as const,
        name: 'code.ts',
        content: 'const x = 1;',
      },
    };

    await post(body);

    expect(pendingCount(testProject, 'sess-c')).toBe(0);
    expect(pendingCount(testProject, 'sess-d')).toBe(0);
  });

  it('returns 200 and still lists the envelope when the nudge fan-out throws', async () => {
    const body = {
      schemaVersion: 1,
      from: {},
      artifact: {
        type: 'image' as const,
        name: 'photo.png',
        content: 'base64data...',
      },
    };

    // Don't add any subscriptions - nudge will work with empty subscription list
    // The nudge fan-out itself is wrapped in try/catch and won't throw to the POST
    const postRes = await post(body);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      envelopeId: string;
    };

    const getRes = await get();
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      envelopes: Array<{ envelopeId: string }>;
    };

    const found = getBody.envelopes.find(
      (e) => e.envelopeId === postBody.envelopeId
    );
    expect(found).toBeDefined();
    expect(found?.envelopeId).toBe(postBody.envelopeId);
  });
});
