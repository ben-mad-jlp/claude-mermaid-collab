// Snippet MCP tool surface — extracted verbatim from setup.ts.
//
// This module owns the cohesive SNIPPET tool group: the ListTools declarations
// (SNIPPET_TOOL_DEFS) and the CallTool handlers (handleSnippetTool). Behavior is
// identical to the original inline setup.ts implementation — this is a pure move.
// (The snippet *service* handlers are still imported by setup.ts too, for the
// duplicate/clear-artifacts paths — this module imports them independently.)
import { API_BASE_URL, buildUrl, asJson, sessionParamsDesc, apiFetch } from './tools/http-util.js';
import {
  createSnippetSchema,
  updateSnippetSchema,
  getSnippetSchema,
  listSnippetsSchema,
  deleteSnippetSchema,
  exportSnippetSchema,
  handleCreateSnippet,
  handleUpdateSnippet,
  handleGetSnippet,
  handleListSnippets,
  handleDeleteSnippet,
  handleExportSnippet,
} from './tools/snippet.js';

/**
 * ListTools declarations for the snippet tool group. Spread into the ListTools
 * array in setup.ts via `...SNIPPET_TOOL_DEFS`.
 */
export const SNIPPET_TOOL_DEFS = [
      {
        name: 'create_snippet',
        description: 'Create a new code snippet artifact.',
        inputSchema: createSnippetSchema,
      },
      {
        name: 'list_snippets',
        description: 'List all snippets in a session.',
        inputSchema: listSnippetsSchema,
      },
      {
        name: 'get_snippet',
        description: 'Retrieve a snippet by ID.',
        inputSchema: getSnippetSchema,
      },
      {
        name: 'add_design_snippet',
        description: 'Create a snippet artifact.',
        inputSchema: createSnippetSchema,
      },
      {
        name: 'update_snippet',
        description: 'Update snippet content.',
        inputSchema: updateSnippetSchema,
      },
      {
        name: 'delete_snippet',
        description: 'Delete a snippet.',
        inputSchema: deleteSnippetSchema,
      },
      {
        name: 'export_snippet',
        description: 'Export snippet to code or other formats.',
        inputSchema: exportSnippetSchema,
      },
      {
        name: 'snippet_history',
        description: 'Get version history for a snippet.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Snippet ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'revert_snippet',
        description: 'Revert a snippet to a previous version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Snippet ID' },
            timestamp: { type: 'number', description: 'Timestamp to revert to' },
          },
          required: ['project', 'session', 'id', 'timestamp'],
        },
      },
      {
        name: 'patch_snippet',
        description: '[DEPRECATED — use update_snippet with full content instead] Replace a range of lines in a snippet. Call get_snippet first — it returns a numberedContent field showing each line with its 1-indexed line number so you can identify startLine/endLine precisely.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Snippet ID' },
            startLine: { type: 'number', description: 'First line to replace (1-indexed). Use the line numbers from get_snippet numberedContent.' },
            endLine: { type: 'number', description: 'Last line to replace (1-indexed, inclusive). Use the line numbers from get_snippet numberedContent.' },
            newContent: { type: 'string', description: 'Replacement lines. Use empty string to delete lines.' },
          },
          required: ['project', 'id', 'startLine', 'endLine', 'newContent'],
        },
      },
];

/**
 * DEPRECATED patch-by-line-range helper, snippet-group-local (was inline in
 * setup.ts). Only the patch_snippet handler calls it.
 */
async function patchSnippet(project: string, session: string, id: string, startLine: number, endLine: number, newContent: string): Promise<string> {
  const getResponse = await apiFetch(buildUrl(`/api/snippet/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Snippet not found: ${id}`);
    }
    throw new Error(`Failed to get snippet: ${getResponse.statusText}`);
  }

  const snippetData = await asJson(getResponse);
  const rawContent: string = snippetData.content;

  // Snippets store code inside a JSON envelope: { code, language, filePath, ... }
  // Replace the specified line range in code field; fall back to raw content for plain-text snippets.
  let updatedContent: string;
  let linesReplaced: number;

  const replaceLines = (code: string): string => {
    const lines = code.split('\n');
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, endLine);
    if (start > lines.length) {
      throw new Error(`startLine ${startLine} is beyond the snippet length (${lines.length} lines)`);
    }
    const newLines = newContent === '' ? [] : newContent.split('\n');
    linesReplaced = end - start + 1;
    lines.splice(start - 1, end - start + 1, ...newLines);
    return lines.join('\n');
  };

  try {
    const parsed = JSON.parse(rawContent);
    if (typeof parsed.code === 'string') {
      parsed.code = replaceLines(parsed.code);
      parsed.originalCode = parsed.code;
      updatedContent = JSON.stringify(parsed);
    } else {
      throw new Error('no code field');
    }
  } catch (e: any) {
    if (e.message.startsWith('startLine') || e.message.startsWith('no code')) throw e;
    // Plain text snippet
    const patched = replaceLines(rawContent);
    updatedContent = patched;
  }

  const updateResponse = await apiFetch(buildUrl(`/api/snippet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: updatedContent }),
  });

  if (!updateResponse.ok) {
    const error = await asJson(updateResponse);
    throw new Error(`Failed to patch snippet: ${error.error || updateResponse.statusText}`);
  }

  return JSON.stringify({
    success: true,
    id,
    message: `Snippet patched: replaced ${linesReplaced!} line(s) at ${startLine}–${endLine} with ${newContent.split('\n').length} line(s)`,
  }, null, 2);
}

/**
 * Handle a snippet-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not a snippet tool — in which case the caller falls through to its own switch.
 */
export async function handleSnippetTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'list_snippets': {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      const result = await handleListSnippets(project, session);
      return JSON.stringify(result, null, 2);
    }

    case 'get_snippet': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleGetSnippet(project, session, id);
      const numberedLines = result.content.split('\n').map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
      return JSON.stringify({ ...result, numberedContent: numberedLines }, null, 2);
    }

    case 'create_snippet':
    case 'add_design_snippet': {
      const { project, session, name, content, sourcePath, startLine, endLine, groupId, groupName, startAt, endAt, maxLines } = args as {
        project: string; session: string; name?: string; content?: string;
        sourcePath?: string; startLine?: number; endLine?: number; groupId?: string; groupName?: string;
        startAt?: string; endAt?: string; maxLines?: number;
      };
      if (!project || !session) throw new Error('Missing required: project, session');
      if (!sourcePath && (!name || content === undefined)) throw new Error('Either provide name+content, or sourcePath');
      const result = await handleCreateSnippet(project, session, name, content);
      return JSON.stringify(result, null, 2);
    }

    case 'update_snippet': {
      const { project, session, id, content } = args as { project: string; session: string; id: string; content: string };
      if (!project || !session || !id || content === undefined) throw new Error('Missing required: project, session, id, content');
      const result = await handleUpdateSnippet(project, session, id, content);
      return JSON.stringify(result, null, 2);
    }

    case 'delete_snippet': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleDeleteSnippet(project, session, id);
      return JSON.stringify(result, null, 2);
    }

    case 'export_snippet': {
      const { project, session, id, format } = args as { project: string; session: string; id: string; format?: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const result = await handleExportSnippet(project, session, id, format);
      return JSON.stringify(result, null, 2);
    }

    case 'snippet_history': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const url = new URL(`/api/snippet/${encodeURIComponent(id)}/history`, API_BASE_URL);
      url.searchParams.set('project', project);
      url.searchParams.set('session', session);
      const resp = await apiFetch(url.toString());
      if (!resp.ok) throw new Error(`Failed to get snippet history: ${resp.statusText}`);
      return JSON.stringify(await resp.json(), null, 2);
    }

    case 'patch_snippet': {
      console.warn('[DEPRECATED] patch_snippet is deprecated. Use update_snippet with full content replacement instead.');
      const { project, session, id, startLine, endLine, newContent } = args as { project: string; session: string; id: string; startLine: number; endLine: number; newContent: string };
      if (!project || !session || !id || startLine === undefined || endLine === undefined || newContent === undefined) throw new Error('Missing required: project, session, id, startLine, endLine, newContent');
      return await patchSnippet(project, session, id, startLine, endLine, newContent);
    }

    case 'revert_snippet': {
      const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: number };
      if (!project || !session || !id || timestamp === undefined) throw new Error('Missing required: project, session, id, timestamp');
      const url = new URL(`/api/snippet/${encodeURIComponent(id)}/version`, API_BASE_URL);
      url.searchParams.set('project', project);
      url.searchParams.set('session', session);
      url.searchParams.set('timestamp', String(timestamp));
      const resp = await apiFetch(url.toString());
      if (!resp.ok) throw new Error(`Failed to get snippet version: ${resp.statusText}`);
      const { content } = await resp.json() as { content: string; timestamp: number };
      // Revert by saving the historical content
      const saveUrl = new URL(`/api/snippet/${encodeURIComponent(id)}`, API_BASE_URL);
      saveUrl.searchParams.set('project', project);
      saveUrl.searchParams.set('session', session);
      const saveResp = await apiFetch(saveUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!saveResp.ok) throw new Error(`Failed to revert snippet: ${saveResp.statusText}`);
      return JSON.stringify({ success: true, revertedTo: timestamp }, null, 2);
    }

    default:
      return null;
  }
}
