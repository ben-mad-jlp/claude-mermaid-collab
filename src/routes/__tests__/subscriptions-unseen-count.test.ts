import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rootDataDir = mkdtempSync(join(tmpdir(), 'subscriptions-unseen-count-'));
process.env.MERMAID_DATA_DIR = rootDataDir;

import { handleAPI } from '../api';
import {
  __resetForTest,
  addSubscription,
  enqueueNotification,
  drainInbox,
  listAllSubscriptions,
} from '../../services/session-subscriptions';

let testDataDir: string;

beforeEach(() => {
  testDataDir = mkdtempSync(join(rootDataDir, 'test-'));
});

afterEach(() => {
  __resetForTest();
});

afterAll(() => {
  rmSync(rootDataDir, { recursive: true, force: true });
  delete process.env.MERMAID_DATA_DIR;
});

const ws = { broadcast() {} } as any;

async function get(project: string): Promise<Response> {
  const req = new Request(
    `http://x/api/subscriptions?project=${encodeURIComponent(project)}`
  );
  return handleAPI(
    req,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    ws,
    new URL(req.url)
  );
}

describe('GET /api/subscriptions', () => {
  it('reports unseen counts per session', async () => {
    const project = testDataDir;
    const session = 'test-session-1';
    const secondSession = 'test-session-2';

    // Add subscriptions
    addSubscription(project, session, 'project');
    addSubscription(project, secondSession, 'project');

    // Enqueue notifications for the first session with varying events
    const notifCount = 3;
    for (let i = 0; i < notifCount; i++) {
      enqueueNotification({
        project,
        session,
        scope: 'project',
        targetId: '',
        event: `event-${i}`,
        summary: `Summary ${i}`,
      });
    }

    // Get subscriptions and verify unseenBySession
    const res = await get(project);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = await res.json() as any;
    expect(body.subscriptions).toBeDefined();
    expect(Array.isArray(body.subscriptions)).toBe(true);
    expect(body.subscriptions.length).toBe(2);

    // Verify unseenBySession has both sessions
    expect(body.unseenBySession).toBeDefined();
    expect(body.unseenBySession[session]).toBe(notifCount);
    expect(body.unseenBySession[secondSession]).toBe(0);

    // Verify subscriptions still has the correct shape
    const firstSub = body.subscriptions.find(
      (s: any) => s.session === session && s.scope === 'project'
    );
    expect(firstSub).toBeDefined();
    expect(firstSub.project).toBe(project);
    expect(firstSub.scope).toBe('project');
    expect(firstSub.targetId).toBe('');
    expect(firstSub.mode).toBe('nudge');
    expect(typeof firstSub.createdAt).toBe('number');
  });

  it('the unseen count is 0 after drainInbox', async () => {
    const project = testDataDir;
    const session = 'test-session-drain';

    // Add subscription and enqueue notifications
    addSubscription(project, session, 'project');
    enqueueNotification({
      project,
      session,
      scope: 'project',
      targetId: '',
      event: 'test-event',
      summary: 'Test notification',
    });

    // Verify unseenBySession shows 1 before drain
    let res = await get(project);
    let body = await res.json() as any;
    expect(body.unseenBySession[session]).toBe(1);

    // Drain the inbox
    drainInbox(project, session);

    // Verify unseenBySession shows 0 after drain
    res = await get(project);
    body = await res.json() as any;
    expect(body.unseenBySession[session]).toBe(0);

    // Verify the subscription row still exists (not removed by drain)
    expect(body.subscriptions.length).toBe(1);
    const sub = body.subscriptions[0];
    expect(sub.project).toBe(project);
    expect(sub.session).toBe(session);
    expect(sub.scope).toBe('project');
  });
});
