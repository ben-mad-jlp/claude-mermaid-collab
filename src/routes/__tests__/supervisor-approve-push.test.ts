import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sent: string[] = [];
mock.module('../../services/tmux-send', () => ({
  sendTmuxKeys: async (_p: string, _s: string, text: string) => { sent.push(text); return { sent: true }; },
  sendTmuxSelection: async () => ({ sent: true }),
}));
// No peer registered → deliverNudge takes the local sendTmuxKeys branch.
mock.module('../../services/ws-handler-manager', () => ({ getWebSocketHandler: () => undefined }));

import { handleSupervisorRoutes } from '../supervisor-routes';

async function post(body: unknown) {
  const req = new Request('http://x/api/supervisor/approve-push', { method: 'POST', body: JSON.stringify(body) });
  return handleSupervisorRoutes(req, new URL(req.url));
}

beforeEach(() => { sent.length = 0; });

describe('POST /api/supervisor/approve-push', () => {
  test('injects a stamped approval/proceed message and returns ok', async () => {
    const res = await post({ project: '/tmp/p', session: 's1' });
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.session).toBe('s1');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/proceed/i);       // proceed marker
    expect(sent[0]).toContain('✅');            // approval marker
    expect(sent[0]).toMatch(/^\[\d{2}:\d{2}/);  // [HH:MM …] stamp prefix
  });

  test('missing session → 400', async () => {
    const res = await post({ project: '/tmp/p' });
    expect(res?.status).toBe(400);
  });

  test('missing project → 400', async () => {
    const res = await post({ session: 's1' });
    expect(res?.status).toBe(400);
  });
});
