import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAgentRegistry } from '../agent/agent-registry-manager.ts';
import type { AgentSessionRegistry } from '../agent/session-registry.ts';

function jsonError(arg1: string | number, arg2: string | number): Response {
  // Support both jsonError(message, status) and jsonError(status, message).
  let message: string;
  let status: number;
  if (typeof arg1 === 'number') {
    status = arg1;
    message = String(arg2);
  } else {
    message = arg1;
    status = Number(arg2);
  }
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function projectToSlug(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const first = content.find((c: any) => c && c.type === 'text');
    if (first && typeof first.text === 'string') return first.text;
    return JSON.stringify(content);
  }
  return '';
}

export interface AgentSessionsOptions {
  homeDir?: () => string;
  slugify?: (projectPath: string) => string;
  getRegistry?: () => AgentSessionRegistry | null;
}

const SESSION_ID_RE = /^\/api\/agent\/sessions\/([^/]+)\/(cost|rename)\/?$/;

export function createAgentSessionsHandler(options: AgentSessionsOptions = {}) {
  const getHome = options.homeDir ?? (() => process.env.HOME ?? homedir());
  const slugify = options.slugify ?? projectToSlug;
  const getRegistry = options.getRegistry;
  return async function handleAgentSessionsAPI(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const pathname = url.pathname;

    // (b) / (c) — /api/agent/sessions/:id/cost | /rename
    const subMatch = SESSION_ID_RE.exec(pathname);
    if (subMatch) {
      const id = decodeURIComponent(subMatch[1]);
      const action = subMatch[2];
      if (action === 'cost') {
        if (method !== 'GET') return jsonError(405, 'Method Not Allowed');
        if (!getRegistry) return jsonError(501, 'Registry not available');
        const registry = getRegistry();
        if (!registry) return jsonError(501, 'Registry not available');
        const meta = registry.getSession(id);
        if (!meta) return jsonError(404, 'Session not found');
        const totals = {
          totalCostUsd: meta.totalCostUsd,
          totalInputTokens: meta.totalInputTokens,
          totalOutputTokens: meta.totalOutputTokens,
          totalCacheReadTokens: meta.totalCacheReadTokens,
          totalCacheCreationTokens: meta.totalCacheCreationTokens,
          lastActivityTs: meta.lastActivityTs,
        };
        const events: any[] = [];
        for await (const ev of registry.getEventLog().replay(id, 0)) {
          if ((ev as any).kind === 'turn_end') events.push(ev);
        }
        const capped = events.slice(-500);
        const turns = capped.map((ev, i) => ({
          turn: i + 1,
          model: meta.model,
          inputTokens: ev.usage?.inputTokens ?? 0,
          outputTokens: ev.usage?.outputTokens ?? 0,
          cacheRead: ev.usage?.cacheReadInputTokens ?? 0,
          cacheCreate: ev.usage?.cacheCreationInputTokens ?? 0,
          costUsd: ev.usage?.costUsd ?? 0,
          ts: ev.ts,
        }));
        return Response.json({ totals, turns });
      }
      if (action === 'rename') {
        if (method !== 'POST') return jsonError(405, 'Method Not Allowed');
        if (!getRegistry) return jsonError(501, 'Registry not available');
        const registry = getRegistry();
        if (!registry) return jsonError(501, 'Registry not available');
        let body: any;
        try {
          body = await req.json();
        } catch {
          return jsonError(400, 'Invalid JSON body');
        }
        const displayName = body?.displayName;
        if (
          typeof displayName !== 'string' ||
          displayName.trim().length < 1 ||
          displayName.trim().length > 128
        ) {
          return jsonError(400, 'displayName must be 1-128 chars');
        }
        const trimmed = displayName.trim();
        if (!registry.getSession(id)) return jsonError(404, 'Session not found');
        registry.setDisplayName(id, trimmed);
        registry.recordAndDispatch(id, {
          kind: 'session_renamed',
          sessionId: id,
          ts: Date.now(),
          displayName: trimmed,
          seq: 0,
        } as any);
        return Response.json({ success: true, sessionId: id, displayName: trimmed });
      }
    }

    // (a) /api/agent/sessions — registry list mode (vs legacy JSONL)
    if (pathname === '/api/agent/sessions' || pathname === '/api/agent/sessions/') {
      const project = url.searchParams.get('project');
      const hasArchived = url.searchParams.has('archived');
      const hasLimit = url.searchParams.has('limit');
      const hasOffset = url.searchParams.has('offset');
      const modeRegistry = url.searchParams.get('mode') === 'registry';
      const hasPhase1Params = hasArchived || hasLimit || hasOffset || modeRegistry;
      const useRegistry = !!getRegistry && (!project || hasPhase1Params);

      if (useRegistry) {
        if (method !== 'GET') return jsonError(405, 'Method Not Allowed');
        const registry = getRegistry!();
        if (!registry) {
          // Registry was requested but is unavailable — return 503 rather than
          // silently falling through to the legacy JSONL path (BUG-05).
          return jsonError(503, 'Registry not available');
        } else {
          const projectRoot =
            url.searchParams.get('project_root') ??
            url.searchParams.get('projectRoot') ??
            undefined;
          const archivedRaw = url.searchParams.get('archived');
          const archived =
            archivedRaw === 'true' ? true : archivedRaw === 'false' ? false : undefined;
          const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
          const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10);
          const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
          const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
          const rows = registry.listSessions({ projectRoot, archived, limit, offset });
          const nextOffset = rows.length === limit ? offset + limit : null;
          return Response.json({ sessions: rows, nextOffset });
        }
      }

      // Legacy JSONL listing — requires ?project=...
      if (!project) return jsonError('Missing required query parameter: project', 400);

      const slug = slugify(project);
      const dir = join(getHome(), '.claude', 'projects', slug);
      if (!existsSync(dir)) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });

      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      const sessions: Array<{
        sessionId: string;
        startedAt?: string;
        firstUserMessage?: string;
        turnCount: number;
        model?: string;
        lastModifiedAt: number;
      }> = [];

      for (const file of files) {
        const full = join(dir, file);
        try {
          const raw = readFileSync(full, 'utf-8');
          const lines = raw.split('\n').filter((l) => l.trim().length > 0);
          let startedAt: string | undefined;
          let firstUserMessage: string | undefined;
          let model: string | undefined;
          let turnCount = 0;
          for (const line of lines) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'user') {
                turnCount++;
                if (!firstUserMessage) {
                  firstUserMessage = extractText(ev.message?.content);
                  if (!startedAt && ev.timestamp) startedAt = ev.timestamp;
                }
              } else if (ev.type === 'assistant' && !model) {
                model = ev.message?.model;
                if (!startedAt && ev.timestamp) startedAt = ev.timestamp;
              }
            } catch {}
          }
          const st = statSync(full);
          sessions.push({
            sessionId: file.replace(/\.jsonl$/, ''),
            startedAt,
            firstUserMessage,
            turnCount,
            model,
            lastModifiedAt: st.mtimeMs,
          });
        } catch {}
      }

      sessions.sort((a, b) => b.lastModifiedAt - a.lastModifiedAt);
      return new Response(JSON.stringify(sessions), { headers: { 'Content-Type': 'application/json' } });
    }

    return jsonError(404, 'Not Found');
  } catch (err) {
    console.error('[Agent Sessions] Error:', err);
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
  };
}

export const handleAgentSessionsAPI = createAgentSessionsHandler({
  getRegistry: () => getAgentRegistry(),
});
