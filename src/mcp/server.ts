#!/usr/bin/env bun
/**
 * MCP Server for Mermaid Diagram Management
 *
 * Provides MCP tools for interacting with the Mermaid collaboration server.
 * All diagram/document operations require project and session parameters
 * to support multi-session workflows.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { dismissUI, dismissUISchema } from './tools/dismiss-ui.js';
import { updateUI, updateUISchema } from './tools/update-ui.js';
import { renderUI, renderUISchema } from './tools/render-ui.js';
import { WebSocketHandler } from '../websocket/handler.js';

// Configuration
const API_PORT = parseInt(process.env.PORT || '3737', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

// Word lists for session name generation
const ADJECTIVES = [
  'bright', 'calm', 'swift', 'bold', 'warm', 'cool', 'soft', 'clear',
  'fresh', 'pure', 'wise', 'keen', 'fair', 'true', 'kind', 'brave',
  'deep', 'wide', 'tall', 'light', 'dark', 'loud', 'quiet', 'quick',
  'slow', 'sharp', 'smooth', 'rough', 'wild', 'free', 'open', 'still'
];

const NOUNS = [
  'river', 'mountain', 'forest', 'meadow', 'ocean', 'valley', 'canyon', 'lake',
  'stream', 'hill', 'cliff', 'beach', 'island', 'bridge', 'tower', 'garden',
  'field', 'grove', 'pond', 'spring', 'peak', 'ridge', 'shore', 'delta',
  'harbor', 'bay', 'cape', 'reef', 'dune', 'oasis', 'mesa', 'fjord'
];

/**
 * Generate a memorable session name (adjective-adjective-noun)
 */
function generateSessionName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

/**
 * Build URL with project and session query params
 */
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

/**
 * Check if the web server is running
 */
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

// ============= Diagram Tools =============

async function listDiagrams(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/diagrams', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list diagrams: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function getDiagram(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function createDiagram(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/diagram', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create diagram: ${error.error || response.statusText}`);
  }
  const data = await response.json();
  const previewUrl = `${API_BASE_URL}/diagram.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Diagram created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

async function updateDiagram(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update diagram: ${error.error || response.statusText}`);
  }
  return JSON.stringify({ success: true, id, message: 'Diagram updated successfully' }, null, 2);
}

async function validateDiagram(content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`Failed to validate diagram: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function previewDiagram(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${response.statusText}`);
  }
  const previewUrl = `${API_BASE_URL}/diagram.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${id}`;
  return JSON.stringify({
    id,
    previewUrl,
    message: `Open this URL in your browser to view the diagram: ${previewUrl}`,
  }, null, 2);
}

async function transpileDiagram(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/transpile/${id}`, project, session));
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to transpile diagram: ${error.error || response.statusText}`);
  }
  const data = await response.json();
  return data.mermaid;
}

// ============= Document Tools =============

async function listDocuments(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/documents', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list documents: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function getDocument(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function createDocument(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/document', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create document: ${error.error || response.statusText}`);
  }
  const data = await response.json();
  const previewUrl = `${API_BASE_URL}/document.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Document created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

async function updateDocument(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update document: ${error.error || response.statusText}`);
  }
  return JSON.stringify({ success: true, id, message: 'Document updated successfully' }, null, 2);
}

async function patchDocument(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  // First, get the current document content
  const getResponse = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${getResponse.statusText}`);
  }
  const docData = await getResponse.json();
  const currentContent = docData.content;

  // Count occurrences of old_string
  const occurrences = currentContent.split(oldString).length - 1;

  if (occurrences === 0) {
    throw new Error(`old_string not found in document. The text you're trying to replace does not exist.`);
  }

  if (occurrences > 1) {
    throw new Error(`old_string matches ${occurrences} locations. Provide more context to make it unique.`);
  }

  // Replace old_string with new_string
  const updatedContent = currentContent.replace(oldString, newString);

  // Write updated content
  const updateResponse = await fetch(buildUrl(`/api/document/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updatedContent,
      patch: { oldString, newString }  // Include patch info for WebSocket broadcast
    }),
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to patch document: ${error.error || updateResponse.statusText}`);
  }

  // Generate a preview snippet around the change
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

async function patchDiagram(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  // First, get the current diagram content
  const getResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${getResponse.statusText}`);
  }

  const diagram = await getResponse.json();
  const currentContent = diagram.content;

  // Check if old_string exists and is unique
  const occurrences = currentContent.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in diagram: "${oldString.slice(0, 50)}..."`);
  }
  if (occurrences > 1) {
    throw new Error(`old_string found ${occurrences} times - must be unique. Add more context to make it unique.`);
  }

  // Apply the replacement
  const updatedContent = currentContent.replace(oldString, newString);

  // Update the diagram
  const updateResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updatedContent,
      patch: { oldString, newString }  // Include patch info for WebSocket broadcast
    }),
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to patch diagram: ${error.error || updateResponse.statusText}`);
  }

  // Generate a preview snippet around the change
  const changeIndex = updatedContent.indexOf(newString);
  const previewStart = Math.max(0, changeIndex - 50);
  const previewEnd = Math.min(updatedContent.length, changeIndex + newString.length + 50);
  const preview = updatedContent.slice(previewStart, previewEnd);

  return JSON.stringify({
    success: true,
    id,
    message: 'Diagram patched successfully',
    preview: `...${preview}...`,
  }, null, 2);
}

async function previewDocument(project: string, session: string, id: string): Promise<string> {
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

// ============= Session Tools =============

async function listSessions(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

// ============= Main Server Setup =============

async function main() {
  // Check if server is running (but don't auto-start)
  if (!(await isServerRunning())) {
    console.error(`Warning: Web server not running at ${API_BASE_URL}`);
    console.error('Start with: mermaid-collab start');
  }

  const server = new Server(
    { name: 'mermaid-diagram-server', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const docsDir = join(__dirname, '..', '..', 'docs');

  // Resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: 'wireframe://syntax-guide',
      name: 'Wireframe Diagram Syntax Guide',
      description: 'Complete syntax reference for creating wireframe diagrams',
      mimeType: 'text/markdown',
    }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === 'wireframe://syntax-guide') {
      const content = await readFile(join(docsDir, 'wireframe-syntax.md'), 'utf-8');
      return { contents: [{ uri, mimeType: 'text/markdown', text: content }] };
    }
    throw new Error(`Unknown resource: ${uri}`);
  });

  // Session params description (shared across tools)
  const sessionParamsDesc = {
    project: {
      type: 'string',
      description: 'Absolute path to the project root directory',
    },
    session: {
      type: 'string',
      description: 'Session name (e.g., "bright-calm-river")',
    },
  };

  // Tools list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'generate_session_name',
        description: 'Generate a memorable session name (adjective-adjective-noun format). Use this when creating a new collab session.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_sessions',
        description: 'List all registered collab sessions across all projects.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_diagrams',
        description: 'List all Mermaid diagrams in a session.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project', 'session'],
        },
      },
      {
        name: 'get_diagram',
        description: 'Read a diagram\'s Mermaid source code by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The diagram ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'create_diagram',
        description: 'Create a new Mermaid diagram. Returns the diagram ID and preview URL.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Diagram name (without .mmd extension)' },
            content: { type: 'string', description: 'Mermaid diagram syntax' },
          },
          required: ['project', 'session', 'name', 'content'],
        },
      },
      {
        name: 'update_diagram',
        description: 'Update an existing diagram\'s content.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The diagram ID' },
            content: { type: 'string', description: 'New Mermaid content' },
          },
          required: ['project', 'session', 'id', 'content'],
        },
      },
      {
        name: 'validate_diagram',
        description: 'Check if Mermaid syntax is valid without saving.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Mermaid syntax to validate' },
          },
          required: ['content'],
        },
      },
      {
        name: 'preview_diagram',
        description: 'Get the browser URL to view a diagram.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The diagram ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'transpile_diagram',
        description: 'Get transpiled Mermaid output for a SMACH diagram.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The SMACH diagram ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'list_documents',
        description: 'List all markdown documents in a session.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project', 'session'],
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
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'create_document',
        description: 'Create a new markdown document. Returns the document ID and preview URL.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Document name (without .md extension)' },
            content: { type: 'string', description: 'Markdown content' },
          },
          required: ['project', 'session', 'name', 'content'],
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
          required: ['project', 'session', 'id', 'content'],
        },
      },
      {
        name: 'patch_document',
        description: 'Apply a search-replace patch to a document. More efficient than update_document for small changes. Fails if old_string is not found or matches multiple locations.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID' },
            old_string: { type: 'string', description: 'Text to find (must be unique in document)' },
            new_string: { type: 'string', description: 'Text to replace with' },
          },
          required: ['project', 'session', 'id', 'old_string', 'new_string'],
        },
      },
      {
        name: 'patch_diagram',
        description: 'Apply a search-replace patch to a diagram. More efficient than update_diagram for small changes. Fails if old_string is not found or matches multiple locations.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The diagram ID' },
            old_string: { type: 'string', description: 'Text to find (must be unique in diagram)' },
            new_string: { type: 'string', description: 'Text to replace with' },
          },
          required: ['project', 'session', 'id', 'old_string', 'new_string'],
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
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'render_ui',
        description: 'Push UI to browser. Renders JSON UI definitions to the browser and manages user interactions. Can optionally block until user action is received.',
        inputSchema: renderUISchema,
      },
      {
        name: 'update_ui',
        description: 'Update the currently displayed UI without full re-render by applying a partial patch to the current UI.',
        inputSchema: updateUISchema,
      },
      {
        name: 'dismiss_ui',
        description: 'Dismiss the currently displayed UI in the browser. Called when user responds in terminal to clear the question panel.',
        inputSchema: dismissUISchema,
      },
    ],
  }));

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      const result = await (async () => {
        switch (name) {
          case 'generate_session_name':
            return JSON.stringify({ name: generateSessionName() }, null, 2);

          case 'list_sessions':
            return await listSessions();

          case 'list_diagrams': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            return await listDiagrams(project, session);
          }

          case 'get_diagram': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await getDiagram(project, session, id);
          }

          case 'create_diagram': {
            const { project, session, name: dName, content } = args as { project: string; session: string; name: string; content: string };
            if (!project || !session || !dName || !content) throw new Error('Missing required: project, session, name, content');
            return await createDiagram(project, session, dName, content);
          }

          case 'update_diagram': {
            const { project, session, id, content } = args as { project: string; session: string; id: string; content: string };
            if (!project || !session || !id || !content) throw new Error('Missing required: project, session, id, content');
            return await updateDiagram(project, session, id, content);
          }

          case 'validate_diagram': {
            const { content } = args as { content: string };
            if (!content) throw new Error('Missing required: content');
            return await validateDiagram(content);
          }

          case 'preview_diagram': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await previewDiagram(project, session, id);
          }

          case 'transpile_diagram': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await transpileDiagram(project, session, id);
          }

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

          case 'patch_diagram': {
            const { project, session, id, old_string, new_string } = args as { project: string; session: string; id: string; old_string: string; new_string: string };
            if (!project || !session || !id || !old_string || new_string === undefined) throw new Error('Missing required: project, session, id, old_string, new_string');
            return await patchDiagram(project, session, id, old_string, new_string);
          }

          case 'preview_document': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await previewDocument(project, session, id);
          }

          case 'render_ui': {
            const { project, session, ui, blocking, timeout } = args as { project: string; session: string; ui: any; blocking?: boolean; timeout?: number };
            if (!project || !session || !ui) throw new Error('Missing required: project, session, ui');
            // Create a WebSocket handler instance for this render
            const wsHandler = new WebSocketHandler();
            const result = await renderUI(project, session, ui, blocking ?? true, timeout, wsHandler);
            return JSON.stringify(result, null, 2);
          }

          case 'update_ui': {
            const { project, session, patch } = args as { project: string; session: string; patch: Record<string, any> };
            if (!project || !session || !patch) throw new Error('Missing required: project, session, patch');
            return await updateUI(project, session, patch);
          }

          case 'dismiss_ui': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            return await dismissUI(project, session);
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      })();

      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Mermaid Diagram Server v2.0 running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
