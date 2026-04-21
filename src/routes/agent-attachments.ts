import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentSessionRegistry } from '../agent/session-registry';
import type { AttachmentUploadedEvent } from '../agent/contracts';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && !id.includes('..');
}

async function dirExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

export async function handleAttachments(
  req: Request,
  url: URL,
  opts?: { registry?: AgentSessionRegistry },
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/agent/attachments')) return null;
  try {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) return jsonError('Missing required query parameter: sessionId', 400);
    if (!isValidSessionId(sessionId)) return jsonError('Invalid sessionId', 400);

    const baseDir = join(process.cwd(), '.collab', 'attachments', sessionId);
    const rest = url.pathname.slice('/api/agent/attachments'.length);
    const itemId = rest.startsWith('/') ? rest.slice(1) : '';

    if (!itemId) {
      // Collection
      if (req.method === 'POST') {
        await mkdir(baseDir, { recursive: true });
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return jsonError('Missing file field', 400);
        const attachmentId = randomUUID();
        const rawType = file.type || 'application/octet-stream';
        const mimeType = rawType.split(';')[0].trim() || 'application/octet-stream';
        const buf = Buffer.from(await file.arrayBuffer());
        await writeFile(join(baseDir, attachmentId), buf);
        const meta = {
          attachmentId,
          originalName: file.name,
          mimeType,
          sizeBytes: file.size,
          createdAt: new Date().toISOString(),
        };
        await writeFile(join(baseDir, attachmentId + '.json'), JSON.stringify(meta));
        const attachmentUrl = `/api/agent/attachments/${attachmentId}?sessionId=${encodeURIComponent(sessionId)}`;
        const event: AttachmentUploadedEvent = {
          kind: 'attachment_uploaded',
          sessionId,
          ts: Date.now(),
          attachmentId,
          mimeType,
          url: attachmentUrl,
          sizeBytes: file.size,
        };
        opts?.registry?.recordAndDispatch(sessionId, event);
        return new Response(
          JSON.stringify({
            attachmentId,
            mimeType,
            url: attachmentUrl,
            sizeBytes: file.size,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (req.method === 'GET') {
        if (!(await dirExists(baseDir))) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
        const entries = await readdir(baseDir);
        const metas = [];
        for (const name of entries) {
          if (!name.endsWith('.json')) continue;
          try {
            const raw = await readFile(join(baseDir, name), 'utf-8');
            metas.push(JSON.parse(raw));
          } catch {}
        }
        return new Response(JSON.stringify(metas), { headers: { 'Content-Type': 'application/json' } });
      }
      return jsonError('Method not allowed', 405);
    }

    // Item
    if (!isValidSessionId(itemId)) return jsonError('Invalid attachmentId', 400);
    const blobPath = join(baseDir, itemId);
    const metaPath = blobPath + '.json';

    if (req.method === 'GET') {
      if (!(await dirExists(metaPath))) return jsonError('Not found', 404);
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      const buf = await readFile(blobPath);
      return new Response(buf, {
        headers: {
          'Content-Type': meta.mimeType,
          'Content-Length': String(meta.sizeBytes),
          'Content-Disposition': `inline; filename="${meta.originalName || itemId}"`,
        },
      });
    }
    if (req.method === 'DELETE') {
      try { await unlink(blobPath); } catch {}
      try { await unlink(metaPath); } catch {}
      return new Response(null, { status: 204 });
    }
    return jsonError('Method not allowed', 405);
  } catch (err) {
    console.error('[Agent Attachments] Error:', err);
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
}
