import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  cs: 'csharp',
  py: 'python',
  md: 'markdown',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  json: 'json',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  css: 'css',
  scss: 'css',
  less: 'css',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'shell',
  sql: 'sql',
};

function inferLanguageFromPath(filePath: string): string {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? 'plaintext';
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleFileContentAPI(req: Request): Promise<Response> {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        return jsonError('path required', 400);
      }
      let content: string;
      try {
        content = await readFile(filePath, 'utf8');
      } catch (err: any) {
        if (err?.code === 'ENOENT') return jsonError('File not found', 404);
        return jsonError(`Failed to read file: ${err?.message ?? err}`, 500);
      }
      const language = inferLanguageFromPath(filePath);
      return Response.json({ content, language });
    }

    if (req.method === 'PUT') {
      let body: { path?: unknown; content?: unknown };
      try {
        body = await req.json();
      } catch {
        return jsonError('Invalid JSON body', 400);
      }
      const filePath = body.path;
      const content = body.content;
      if (typeof filePath !== 'string' || !filePath) {
        return jsonError('path and content required', 400);
      }
      if (content === undefined || content === null) {
        return jsonError('path and content required', 400);
      }
      if (typeof content !== 'string') {
        return jsonError('content must be a string', 400);
      }
      try {
        await writeFile(filePath, content, 'utf8');
      } catch (err: any) {
        return jsonError(`Failed to write file: ${err?.message ?? err}`, 500);
      }
      return new Response(null, { status: 204 });
    }

    return jsonError('Method not allowed', 405);
  } catch (error) {
    console.error('[File Content API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonError(message, 500);
  }
}
