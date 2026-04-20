import { describe, it, expect, afterEach } from 'bun:test';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleAttachments } from '../agent-attachments';

const sessionId = 'test-session-' + randomUUID().replace(/-/g, '').slice(0, 12);
const baseDir = join(process.cwd(), '.collab', 'attachments', sessionId);

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: BodyInit, headers?: Record<string, string>) {
  const req = new Request('http://localhost' + path, { method, body, headers });
  const url = new URL(req.url);
  return handleAttachments(req, url);
}

describe('handleAttachments', () => {
  it('POST uploads and returns metadata', async () => {
    const form = new FormData();
    form.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'hello.txt');
    const res = await call('POST', `/api/agent/attachments?sessionId=${sessionId}`, form);
    expect(res?.status).toBe(201);
    const body: any = await res!.json();
    expect(body.attachmentId).toBeTruthy();
    expect(body.mimeType).toBe('text/plain');
    expect(body.sizeBytes).toBe(11);
  });

  it('GET collection returns list', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    await call('POST', `/api/agent/attachments?sessionId=${sessionId}`, form);
    const res = await call('GET', `/api/agent/attachments?sessionId=${sessionId}`);
    expect(res?.status).toBe(200);
    const list: any = await res!.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('missing sessionId returns 400', async () => {
    const res = await call('GET', `/api/agent/attachments`);
    expect(res?.status).toBe(400);
  });

  it('non-matching prefix returns null', async () => {
    const req = new Request('http://localhost/api/other');
    const res = await handleAttachments(req, new URL(req.url));
    expect(res).toBeNull();
  });
});
