// Document MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive DOCUMENT tool group: the ListTools declarations
// (DOCUMENT_TOOL_DEFS) and the CallTool handlers (handleDocumentTool), PLUS the
// document helper functions (listDocuments/getDocument/createDocument/...) that
// were previously local to setup.ts. The helpers are exported because setup.ts
// still calls them from other tool flows (design/diagram/etc.) — those import them
// back from here. This module imports only ./tools/http-util.js, so there is no
// import cycle with setup.ts. Behavior is identical — a pure move.
import { API_BASE_URL, buildUrl, asJson, sessionParamsDesc } from './tools/http-util.js';

// ---------------------------------------------------------------------------
// Document helpers (were inline in setup.ts; exported for setup.ts's other callers)
// ---------------------------------------------------------------------------

export async function listDocuments(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/documents', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list documents: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function getDocument(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function createDocument(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/document', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
    throw new Error(`Failed to create document: ${error.error || response.statusText}`);
  }
  const data = await asJson(response);
  const previewUrl = `${API_BASE_URL}/document.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Document created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

export async function updateDocument(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
    throw new Error(`Failed to update document: ${error.error || response.statusText}`);
  }
  return JSON.stringify({ success: true, id, message: 'Document updated successfully' }, null, 2);
}

export async function patchDocument(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  const getResponse = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${getResponse.statusText}`);
  }
  const docData = await asJson(getResponse);
  const currentContent = docData.content;

  const occurrences = currentContent.split(oldString).length - 1;

  if (occurrences === 0) {
    throw new Error(`old_string not found in document. The text you're trying to replace does not exist.`);
  }

  if (occurrences > 1) {
    throw new Error(`old_string matches ${occurrences} locations. Provide more context to make it unique.`);
  }

  const updatedContent = currentContent.replace(oldString, newString);

  const updateResponse = await fetch(buildUrl(`/api/document/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updatedContent,
      patch: { oldString, newString }
    }),
  });

  if (!updateResponse.ok) {
    const error = await asJson(updateResponse);
    throw new Error(`Failed to patch document: ${error.error || updateResponse.statusText}`);
  }

  const changeIndex = updatedContent.indexOf(newString);
  const previewStart = Math.max(0, changeIndex - 50);
  const previewEnd = Math.min(updatedContent.length, changeIndex + newString.length + 50);
  const preview = updatedContent.slice(previewStart, previewEnd);

  return JSON.stringify({
    success: true,
    id,
    message: 'Document patched successfully',
    preview: `...${preview}...`,
  }, null, 2);
}

export async function previewDocument(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }
  const previewUrl = `${API_BASE_URL}/document.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${id}`;
  return JSON.stringify({
    id,
    previewUrl,
    message: `Open this URL in your browser to view the document: ${previewUrl}`,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// ListTools declarations — spread into setup.ts via `...DOCUMENT_TOOL_DEFS`.
// ---------------------------------------------------------------------------

export const DOCUMENT_TOOL_DEFS = [
      {
        name: 'list_documents',
        description: 'List all markdown documents in a session.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project'],
        },
      },
      {
        name: 'get_document',
        description: 'Read a document\'s content by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'create_document',
        description: 'Create a new markdown document. Returns the document ID and preview URL. Supports {{diagram:id}} and {{design:id}} embed syntax for live artifact rendering in previews.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Document name (without .md extension)' },
            content: { type: 'string', description: 'Markdown content' },
          },
          required: ['project', 'name', 'content'],
        },
      },
      {
        name: 'update_document',
        description: 'Update an existing document\'s content.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID' },
            content: { type: 'string', description: 'New markdown content' },
          },
          required: ['project', 'id', 'content'],
        },
      },
      {
        name: 'patch_document',
        description: 'Apply a search-replace patch to a document. More efficient than update_document for small changes. Fails if old_string is not found or matches multiple locations. Documents support {{diagram:id}} and {{design:id}} embed syntax.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID' },
            old_string: { type: 'string', description: 'Text to find (must be unique in document)' },
            new_string: { type: 'string', description: 'Text to replace with' },
          },
          required: ['project', 'id', 'old_string', 'new_string'],
        },
      },
      // Document History & Revert
      {
        name: 'get_document_history',
        description: 'Get the change history for a document. Returns original content and list of changes with timestamps.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Document ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'revert_document',
        description: 'Revert a document to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Document ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'id', 'timestamp'],
        },
      },
      {
        name: 'delete_document',
        description: 'Delete a document by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Document ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'preview_document',
        description: 'Get the browser URL to view a document.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID' },
          },
          required: ['project', 'id'],
        },
      },
];

/**
 * Handle a document-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not a document tool — in which case the caller falls through to its own switch.
 */
export async function handleDocumentTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'list_documents': {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      return await listDocuments(project, session);
    }

    case 'get_document': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      return await getDocument(project, session, id);
    }

    case 'create_document': {
      const { project, session, name: dName, content } = args as { project: string; session: string; name: string; content: string };
      if (!project || !session || !dName || !content) throw new Error('Missing required: project, session, name, content');
      return await createDocument(project, session, dName, content);
    }

    case 'update_document': {
      const { project, session, id, content } = args as { project: string; session: string; id: string; content: string };
      if (!project || !session || !id || !content) throw new Error('Missing required: project, session, id, content');
      return await updateDocument(project, session, id, content);
    }

    case 'patch_document': {
      const { project, session, id, old_string, new_string } = args as { project: string; session: string; id: string; old_string: string; new_string: string };
      if (!project || !session || !id || !old_string || new_string === undefined) throw new Error('Missing required: project, session, id, old_string, new_string');
      return await patchDocument(project, session, id, old_string, new_string);
    }

    // Document History & Revert
    case 'get_document_history': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const response = await fetch(buildUrl(`/api/document/${id}/history`, project, session));
      if (!response.ok) {
        if (response.status === 404) {
          return JSON.stringify({ error: 'No history for document', history: null }, null, 2);
        }
        throw new Error(`Failed to get document history: ${response.statusText}`);
      }
      const data = await asJson(response);
      return JSON.stringify(data, null, 2);
    }

    case 'revert_document': {
      const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
      if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
      const versionResponse = await fetch(buildUrl(`/api/document/${id}/version`, project, session, { timestamp }));
      if (!versionResponse.ok) {
        throw new Error(`Failed to get document version: ${versionResponse.statusText}`);
      }
      const versionData = await versionResponse.json() as { content: string };
      const updateResponse = await fetch(buildUrl(`/api/document/${id}`, project, session), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: versionData.content }),
      });
      if (!updateResponse.ok) {
        const error = await updateResponse.json() as { error?: string };
        throw new Error(`Failed to revert document: ${error.error || updateResponse.statusText}`);
      }
      return JSON.stringify({
        success: true,
        id,
        revertedTo: timestamp,
        message: `Document reverted to version from ${timestamp}`,
      }, null, 2);
    }

    case 'delete_document': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      const response = await fetch(buildUrl(`/api/document/${id}`, project, session), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json() as { error?: string };
        throw new Error(`Failed to delete document: ${error.error || response.statusText}`);
      }
      return JSON.stringify({ success: true, id, message: 'Document deleted' }, null, 2);
    }

    case 'preview_document': {
      const { project, session, id } = args as { project: string; session: string; id: string };
      if (!project || !session || !id) throw new Error('Missing required: project, session, id');
      return await previewDocument(project, session, id);
    }

    default:
      return null;
  }
}
