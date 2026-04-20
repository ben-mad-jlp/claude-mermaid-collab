import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleAgentSessionsAPI } from '../agent-sessions';

let tmpHome: string;
const project = '/tmp/foo/bar';
const slug = project.replace(/\//g, '-');
let originalHome: string | undefined;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'agent-sessions-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  const dir = join(tmpHome, '.claude', 'projects', slug);
  mkdirSync(dir, { recursive: true });
  const linesA = [
    JSON.stringify({ type: 'user', timestamp: '2026-04-18T10:00:00Z', message: { content: 'hello' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-7' } }),
    JSON.stringify({ type: 'user', message: { content: 'again' } }),
  ].join('\n');
  writeFileSync(join(dir, 'session-a.jsonl'), linesA);
  writeFileSync(join(dir, 'session-b.jsonl'),
    JSON.stringify({ type: 'user', timestamp: '2026-04-18T11:00:00Z', message: { content: [{ type: 'text', text: 'arr-form' }] } })
  );
});

afterAll(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('handleAgentSessionsAPI', () => {
  it('returns 400 when project missing', async () => {
    const res = await handleAgentSessionsAPI(new Request('http://x/api/agent/sessions'));
    expect(res.status).toBe(400);
  });

  it('returns [] for nonexistent project', async () => {
    const res = await handleAgentSessionsAPI(new Request('http://x/api/agent/sessions?project=/no/such/path'));
    const body: any = await res.json();
    expect(body).toEqual([]);
  });

  it('lists sessions with turnCount, model, firstUserMessage', async () => {
    const res = await handleAgentSessionsAPI(new Request('http://x/api/agent/sessions?project=' + project));
    const body: any[] = await res.json();
    expect(body.length).toBe(2);
    const a = body.find((s) => s.sessionId === 'session-a');
    const b = body.find((s) => s.sessionId === 'session-b');
    expect(a.turnCount).toBe(2);
    expect(a.model).toBe('claude-opus-4-7');
    expect(a.firstUserMessage).toBe('hello');
    expect(b.firstUserMessage).toBe('arr-form');
  });
});
