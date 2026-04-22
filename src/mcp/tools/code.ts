/**
 * MCP Code Tools
 *
 * Tools for linking, pushing, syncing, and reviewing code file artifacts.
 * Code files are first-class artifacts distinct from snippets.
 */

import { editDecisionBridge } from '../../agent/edit-decision-bridge.js';

// ============= Constants =============

const API_PORT = parseInt(process.env.PORT ?? '9002', 10);
const API_HOST = process.env.HOST ?? 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

function buildUrl(path: string, project: string, session: string, extraParams?: Record<string, string>): string {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set('project', project);
  url.searchParams.set('session', session);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name.' },
};


// ============= Schemas =============

export const createCodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    filePath: { type: 'string', description: 'Absolute path to the file to link' },
    name: { type: 'string', description: 'Display name for the linked file (defaults to basename)' },
  },
  required: ['project', 'session', 'filePath'],
};

export const pushCodeToFileSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
  },
  required: ['project', 'session', 'id'],
};

export const syncCodeFromDiskSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
  },
  required: ['project', 'session', 'id'],
};

export const reviewCodeEditsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
    format: { type: 'string', enum: ['diff', 'full'], description: 'Output format: diff (unified diff) or full (all fields). Default: diff' },
  },
  required: ['project', 'session', 'id'],
};

export const listCodeFilesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
  },
  required: ['project', 'session'],
};

export const proposeCodeEditSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
    newCode: { type: 'string', description: 'Proposed full-file content. Replaces the entire file, not a patch.' },
    message: { type: 'string', description: 'Short human-readable explanation of the proposed change.' },
  },
  required: ['project', 'session', 'id', 'newCode'],
};

export const waitForEditDecisionSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID whose edit decision to wait for.' },
    timeoutMs: { type: 'number', description: 'How long to wait in milliseconds before timing out (default 300000).' },
  },
  required: ['project', 'session', 'id'],
};

export const updateCodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
    content: { type: 'string', description: 'New full file content' },
  },
  required: ['project', 'session', 'id', 'content'],
};

export const getCodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    id: { type: 'string', description: 'Code file artifact ID' },
  },
  required: ['project', 'session', 'id'],
};

// ============= Handlers =============

export async function handleCreateCode(
  project: string,
  session: string,
  filePath: string,
  name?: string,
): Promise<{ success: boolean; id: string; existed?: boolean }> {
  const url = buildUrl('/api/code/create', project, session);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, name }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as any;
    throw new Error(`Failed to create code file: ${error.error ?? res.statusText}`);
  }

  const data = await res.json() as any;
  return { success: true, id: data.id, existed: data.existed };
}

export async function handlePushCodeToFile(
  project: string,
  session: string,
  id: string,
): Promise<{ success: boolean; filePath: string; bytesWritten: number }> {
  const response = await fetch(buildUrl(`/api/code/push/${id}`, project, session), {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to push code to file: ${error.error || response.statusText}`);
  }

  return await response.json() as any;
}

export async function handleSyncCodeFromDisk(
  project: string,
  session: string,
  id: string,
): Promise<{ success: boolean; diskChanged: boolean; hasLocalEdits: boolean; conflict: boolean }> {
  const response = await fetch(buildUrl(`/api/code/sync/${id}`, project, session), {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to sync from disk: ${error.error || response.statusText}`);
  }

  return await response.json() as any;
}

export async function handleReviewCodeEdits(
  project: string,
  session: string,
  id: string,
  format: 'diff' | 'full' = 'diff',
): Promise<Record<string, unknown>> {
  if (format === 'diff') {
    const response = await fetch(buildUrl(`/api/code/diff/${encodeURIComponent(id)}`, project, session));
    if (!response.ok) {
      const e = await response.json().catch(() => ({})) as any;
      throw new Error(e.error ?? `Code file not found: ${id}`);
    }
    const data = await response.json() as any;
    // Also fetch record for filePath/language
    const recRes = await fetch(buildUrl(`/api/code/get/${encodeURIComponent(id)}`, project, session));
    const rec = recRes.ok ? await recRes.json() as any : {} as any;
    return {
      id,
      filePath: rec.filePath,
      language: rec.language,
      diff: data.localVsDisk,
    };
  }

  // format === 'full'
  const response = await fetch(buildUrl(`/api/code/get/${encodeURIComponent(id)}`, project, session));
  if (!response.ok) {
    const e = await response.json().catch(() => ({})) as any;
    throw new Error(e.error ?? `Code file not found: ${id}`);
  }
  const rec = await response.json() as any;
  return {
    id,
    filePath: rec.filePath,
    language: rec.language,
    content: rec.content,
    contentHash: rec.contentHash,
    dirty: rec.dirty,
    lastPushedAt: rec.lastPushedAt,
    hasProposedEdit: rec.hasProposedEdit,
  };
}

export async function handleProposeCodeEdit(
  project: string,
  session: string,
  id: string,
  newCode: string,
  message?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(buildUrl(`/api/code/proposed-edit/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newCode, message }),
  });

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(`Failed to propose code edit: ${error.error || response.statusText}`);
  }

  return await response.json() as any;
}

export async function handleWaitForEditDecision(
  project: string,
  session: string,
  id: string,
  timeoutMs?: number,
): Promise<{ content: [{ type: 'text'; text: string }]; isError?: boolean }> {
  try {
    const decision = await editDecisionBridge.wait(project, session, id, timeoutMs ?? 300_000);
    return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'edit_decision_timeout') {
      return { content: [{ type: 'text', text: JSON.stringify({ decision: 'timeout' }) }], isError: true };
    }
    if (msg === 'replaced') return { content: [{ type: 'text', text: JSON.stringify({ decision: 'replaced' }) }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({ decision: 'cancelled' }) }], isError: true };
  }
}

export async function handleListCodeFiles(
  project: string,
  session: string,
): Promise<{ files: Array<{ id: string; name: string; filePath: string; language: string; dirty: boolean; lastPushedAt: string | null }> }> {
  const response = await fetch(buildUrl('/api/code/list', project, session));

  if (!response.ok) {
    const e = await response.json().catch(() => ({})) as any;
    throw new Error(e.error ?? `Failed to list code files: ${response.statusText}`);
  }

  const data = await response.json() as any;
  return { files: data.files };
}

export async function handleUpdateCode(params: { project: string; session: string; id: string; content: string }) {
  const { project, session, id, content } = params;
  const url = buildUrl(`/api/code/update/${encodeURIComponent(id)}`, project, session);
  const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? `HTTP ${res.status}`); }
  return await res.json();
}

export async function handleGetCode(params: { project: string; session: string; id: string }) {
  const { project, session, id } = params;
  const url = buildUrl(`/api/code/get/${encodeURIComponent(id)}`, project, session);
  const res = await fetch(url);
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? `HTTP ${res.status}`); }
  return await res.json();
}
