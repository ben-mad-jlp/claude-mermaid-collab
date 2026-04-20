import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function jsonError(message: string, status: number): Response {
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
}

export function createAgentSessionsHandler(options: AgentSessionsOptions = {}) {
  const getHome = options.homeDir ?? (() => process.env.HOME ?? homedir());
  const slugify = options.slugify ?? projectToSlug;
  return async function handleAgentSessionsAPI(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const project = url.searchParams.get('project');
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
  } catch (err) {
    console.error('[Agent Sessions] Error:', err);
    return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
  }
  };
}

export const handleAgentSessionsAPI = createAgentSessionsHandler();
