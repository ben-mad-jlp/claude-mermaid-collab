/**
 * MCP Server Setup
 *
 * Shared MCP server configuration used by both stdio and HTTP transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Resvg } from '@resvg/resvg-js';
import { dismissUI, dismissUISchema } from './tools/dismiss-ui.js';
import { updateUI, updateUISchema } from './tools/update-ui.js';
import { renderUISchema } from './tools/render-ui.js';
import { terminalToolSchemas } from './tools/terminal-sessions.js';
import {
  getSessionState,
  updateSessionState,
  archiveSession,
} from './tools/collab-state.js';
import { completeSkill } from './workflow/complete-skill.js';
import {
  handleListProjects,
  handleRegisterProject,
  handleUnregisterProject,
  listProjectsSchema,
  registerProjectSchema,
  unregisterProjectSchema,
} from './tools/projects.js';
import { getKodexManager } from '../services/kodex-manager.js';
import type { FlagType, TopicContent } from '../services/kodex-manager.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { sessionRegistry } from '../services/session-registry.js';
import { projectRegistry } from '../services/project-registry.js';
import { updateTaskStatus, updateTasksStatus, getTaskGraph } from './workflow/task-status.js';
import {
  handleCreateWireframe,
  handleUpdateWireframe,
  handleGetWireframe,
  handleListWireframes,
  handlePreviewWireframe,
  handleExportWireframeSVG,
  handleExportWireframePNG,
  createWireframeSchema,
  updateWireframeSchema,
  getWireframeSchema,
  listWireframesSchema,
  previewWireframeSchema,
  exportWireframeSVGSchema,
  exportWireframePNGSchema,
} from './tools/wireframe.js';

// Configuration
const API_PORT = parseInt(process.env.PORT || '3737', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

// Version is synced with package.json via npm version command
const SERVER_VERSION = '5.26.0';

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

function generateSessionName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

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

async function exportDiagramSVG(project: string, session: string, id: string, theme?: string): Promise<string> {
  const themeParam = theme ? `&theme=${encodeURIComponent(theme)}` : '';
  const response = await fetch(buildUrl(`/api/render/${id}`, project, session) + themeParam);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to export diagram: ${response.statusText}`);
  }
  const svg = await response.text();

  // Extract dimensions from SVG
  const widthMatch = svg.match(/width="([^"]+)"/);
  const heightMatch = svg.match(/height="([^"]+)"/);
  const width = widthMatch ? widthMatch[1] : 'auto';
  const height = heightMatch ? heightMatch[1] : 'auto';

  return JSON.stringify({
    id,
    svg,
    width,
    height,
  }, null, 2);
}

async function exportDiagramPNG(project: string, session: string, id: string, theme?: string, scale?: number): Promise<string> {
  // First get the SVG
  const themeParam = theme ? `&theme=${encodeURIComponent(theme)}` : '';
  const response = await fetch(buildUrl(`/api/render/${id}`, project, session) + themeParam);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to export diagram: ${response.statusText}`);
  }
  const svg = await response.text();

  // Convert SVG to PNG using resvg
  const resvg = new Resvg(svg, {
    background: '#ffffff',
    fitTo: scale ? {
      mode: 'zoom' as const,
      value: scale,
    } : {
      mode: 'original' as const,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const png = Buffer.from(pngBuffer).toString('base64');

  // Extract dimensions
  const widthMatch = svg.match(/width="([^"]+)"/);
  const heightMatch = svg.match(/height="([^"]+)"/);
  const width = widthMatch ? widthMatch[1] : 'auto';
  const height = heightMatch ? heightMatch[1] : 'auto';

  return JSON.stringify({
    id,
    png,
    width,
    height,
    note: 'PNG is base64 encoded. Save with: echo "<png>" | base64 -d > diagram.png',
  }, null, 2);
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
  const getResponse = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${getResponse.statusText}`);
  }
  const docData = await getResponse.json();
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
    const error = await updateResponse.json();
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

async function patchDiagram(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  const getResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${getResponse.statusText}`);
  }

  const diagram = await getResponse.json();
  const currentContent = diagram.content;

  const occurrences = currentContent.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in diagram: "${oldString.slice(0, 50)}..."`);
  }
  if (occurrences > 1) {
    throw new Error(`old_string found ${occurrences} times - must be unique. Add more context to make it unique.`);
  }

  const updatedContent = currentContent.replace(oldString, newString);

  const updateResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: updatedContent,
      patch: { oldString, newString }
    }),
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to patch diagram: ${error.error || updateResponse.statusText}`);
  }

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

// ============= Server Setup =============

export async function setupMCPServer(): Promise<Server> {
  const server = new Server(
    { name: 'mermaid-diagram-server', version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

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

  // Resources - none currently registered
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    throw new Error(`Unknown resource: ${uri}`);
  });

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
        name: 'list_projects',
        description: 'List all registered projects',
        inputSchema: listProjectsSchema,
      },
      {
        name: 'register_project',
        description: 'Register a new project',
        inputSchema: registerProjectSchema,
      },
      {
        name: 'unregister_project',
        description: 'Unregister a project (does not delete files)',
        inputSchema: unregisterProjectSchema,
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
        name: 'export_diagram_svg',
        description: 'Export a diagram as an SVG image string. Returns the complete SVG markup that can be saved or displayed.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Diagram ID' },
            theme: { type: 'string', description: 'Mermaid theme (default, dark, forest, neutral). Default: default' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'export_diagram_png',
        description: 'Export a diagram as a PNG image. Returns base64-encoded PNG data that can be saved to a file and viewed.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Diagram ID' },
            theme: { type: 'string', description: 'Mermaid theme (default, dark, forest, neutral). Default: default' },
            scale: { type: 'number', description: 'Scale factor for the PNG (default: 1)' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'get_diagram_history',
        description: 'Get the change history for a diagram. Returns original content and list of changes with timestamps.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Diagram ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'revert_diagram',
        description: 'Revert a diagram to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Diagram ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'session', 'id', 'timestamp'],
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
        name: 'create_wireframe',
        description: 'Create a new wireframe. Returns the wireframe ID and preview URL.',
        inputSchema: createWireframeSchema,
      },
      {
        name: 'update_wireframe',
        description: 'Update an existing wireframe\'s content.',
        inputSchema: updateWireframeSchema,
      },
      {
        name: 'get_wireframe',
        description: 'Read a wireframe\'s content by ID.',
        inputSchema: getWireframeSchema,
      },
      {
        name: 'list_wireframes',
        description: 'List all wireframes in a session.',
        inputSchema: listWireframesSchema,
      },
      {
        name: 'preview_wireframe',
        description: 'Get the browser URL to view a wireframe.',
        inputSchema: previewWireframeSchema,
      },
      {
        name: 'export_wireframe_svg',
        description: 'Export a wireframe as an SVG image string. Returns the complete SVG markup that can be saved or displayed.',
        inputSchema: exportWireframeSVGSchema,
      },
      {
        name: 'export_wireframe_png',
        description: 'Export a wireframe as a PNG image. Returns base64-encoded PNG data that can be saved to a file and viewed.',
        inputSchema: exportWireframePNGSchema,
      },
      {
        name: 'validate_wireframe',
        description: 'Check if wireframe JSON is valid without saving.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'object', description: 'Wireframe JSON to validate' },
          },
          required: ['content'],
        },
      },
      {
        name: 'get_wireframe_history',
        description: 'Get the change history for a wireframe. Returns original content and list of changes with timestamps.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to the project root directory' },
            session: { type: 'string', description: 'Session name (e.g., "bright-calm-river")' },
            id: { type: 'string', description: 'Wireframe ID' },
          },
          required: ['project', 'session', 'id'],
        },
      },
      {
        name: 'revert_wireframe',
        description: 'Revert a wireframe to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to the project root directory' },
            session: { type: 'string', description: 'Session name (e.g., "bright-calm-river")' },
            id: { type: 'string', description: 'Wireframe ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'session', 'id', 'timestamp'],
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
      {
        name: 'get_ui_response',
        description: 'Poll for UI response status. Use after render_ui with blocking=false to check if user has responded.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to the project root directory' },
            session: { type: 'string', description: 'Session name (e.g., "bright-calm-river")' },
            uiId: { type: 'string', description: 'UI ID returned from render_ui' },
          },
          required: ['project', 'session', 'uiId'],
        },
      },
      {
        name: 'check_server_health',
        description: 'Check if MCP server, HTTP/API backend, and React UI are running',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_install_path',
        description: 'Get the installation path of the mermaid-collab plugin. Use this to run CLI commands like server start/stop.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_session_state',
        description: 'Get current collab session state (phase, currentItem, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'update_session_state',
        description: 'Update collab session state fields (auto-updates lastActivity)',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            phase: { type: 'string', description: 'Current phase' },
            currentItem: { type: ['number', 'null'], description: 'Current work item number' },
            currentItemType: { type: 'string', enum: ['code', 'task', 'bugfix'], description: 'Type of current work item' },
            workItems: {
              type: 'array',
              description: 'Work items for the session',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'number', description: 'Item number' },
                  title: { type: 'string', description: 'Item title' },
                  type: { type: 'string', enum: ['code', 'task', 'bugfix'], description: 'Item type' },
                  status: { type: 'string', enum: ['pending', 'documented'], description: 'Item status' },
                },
                required: ['number', 'title', 'type', 'status'],
              },
            },
            completedTasks: { type: 'array', items: { type: 'string' }, description: 'Completed task IDs' },
            pendingTasks: { type: 'array', items: { type: 'string' }, description: 'Pending task IDs' },
            totalItems: { type: 'number', description: 'Total number of work items (for brainstorming/rough-draft phases)' },
            documentedItems: { type: 'number', description: 'Number of documented items (for brainstorming/rough-draft phases)' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'archive_session',
        description: 'Archive a collab session by copying documents, diagrams, and wireframes to docs/designs/[session]/ and optionally deleting the session folder.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name to archive' },
            delete_session: { type: 'boolean', description: 'Delete the session after archiving (default: true)' },
            timestamp: { type: 'boolean', description: 'Add timestamp to archive folder name (default: false)' },
          },
          required: ['project', 'session'],
        },
      },
      terminalToolSchemas.terminal_create_session,
      terminalToolSchemas.terminal_list_sessions,
      terminalToolSchemas.terminal_kill_session,
      terminalToolSchemas.terminal_rename_session,
      terminalToolSchemas.terminal_reorder_sessions,
      // Kodex tools
      {
        name: 'kodex_query_topic',
        description: 'Query a topic from the project knowledge base. Returns topic content and metadata, or logs missing topic if not found.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name (kebab-case)' },
            include_content: { type: 'boolean', description: 'Include full content (default: true)' },
          },
          required: ['project', 'name'],
        },
      },
      {
        name: 'kodex_list_topics',
        description: 'List all topics in the project knowledge base.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            filter: { type: 'string', enum: ['all', 'verified', 'unverified', 'has_draft'], description: 'Filter topics (default: all)' },
          },
          required: ['project'],
        },
      },
      {
        name: 'kodex_create_topic',
        description: 'Create a new topic (as draft). Requires human approval before going live.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name (kebab-case)' },
            title: { type: 'string', description: 'Human-readable title' },
            content: {
              type: 'object',
              properties: {
                conceptual: { type: 'string', description: 'Conceptual overview' },
                technical: { type: 'string', description: 'Technical details' },
                files: { type: 'string', description: 'Related files' },
                related: { type: 'string', description: 'Related topics' },
              },
              required: ['conceptual', 'technical', 'files', 'related'],
            },
          },
          required: ['project', 'name', 'title', 'content'],
        },
      },
      {
        name: 'kodex_update_topic',
        description: 'Update an existing topic (creates draft). Requires human approval.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name' },
            content: {
              type: 'object',
              properties: {
                conceptual: { type: 'string', description: 'Conceptual overview' },
                technical: { type: 'string', description: 'Technical details' },
                files: { type: 'string', description: 'Related files' },
                related: { type: 'string', description: 'Related topics' },
              },
            },
            reason: { type: 'string', description: 'Reason for the update' },
          },
          required: ['project', 'name', 'content', 'reason'],
        },
      },
      {
        name: 'kodex_flag_topic',
        description: 'Flag a topic for review (outdated, incorrect, incomplete, or missing).',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name' },
            type: { type: 'string', enum: ['outdated', 'incorrect', 'incomplete', 'missing'], description: 'Flag type' },
            description: { type: 'string', description: 'Description of the issue' },
          },
          required: ['project', 'name', 'type', 'description'],
        },
      },
      {
        name: 'kodex_verify_topic',
        description: 'Mark a topic as verified (human-only operation).',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name' },
            verified_by: { type: 'string', description: 'Who is verifying' },
          },
          required: ['project', 'name', 'verified_by'],
        },
      },
      {
        name: 'kodex_list_drafts',
        description: 'List all pending drafts awaiting approval. Returns summary (names only) by default to reduce response size.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            include_content: { type: 'boolean', description: 'Include full draft content (default: false for summary only)' },
          },
          required: ['project'],
        },
      },
      {
        name: 'kodex_approve_draft',
        description: 'Approve a pending draft (human-only operation).',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name' },
          },
          required: ['project', 'name'],
        },
      },
      {
        name: 'kodex_reject_draft',
        description: 'Reject a pending draft (human-only operation).',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            name: { type: 'string', description: 'Topic name' },
          },
          required: ['project', 'name'],
        },
      },
      {
        name: 'kodex_dashboard',
        description: 'Get Kodex dashboard stats (total topics, verified, drafts, flags, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
          },
          required: ['project'],
        },
      },
      {
        name: 'kodex_list_flags',
        description: 'List flagged topics.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            status: { type: 'string', enum: ['open', 'resolved', 'dismissed'], description: 'Filter by status' },
          },
          required: ['project'],
        },
      },
      {
        name: 'kodex_add_alias',
        description: 'Add an alias to a topic',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            topicName: { type: 'string', description: 'Topic name' },
            alias: { type: 'string', description: 'Alias to add' },
          },
          required: ['project', 'topicName', 'alias'],
        },
      },
      {
        name: 'kodex_remove_alias',
        description: 'Remove an alias from a topic',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            topicName: { type: 'string', description: 'Topic name' },
            alias: { type: 'string', description: 'Alias to remove' },
          },
          required: ['project', 'topicName', 'alias'],
        },
      },
      // Workflow orchestration
      {
        name: 'complete_skill',
        description: 'Report skill completion and get next skill to invoke. MCP handles all routing and state updates.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            skill: { type: 'string', description: 'Name of the skill that just completed' },
          },
          required: ['project', 'session', 'skill'],
        },
      },
      // Task management tools
      {
        name: 'update_task_status',
        description: 'Update a task\'s status and regenerate the task graph. Broadcasts updates via WebSocket.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            taskId: { type: 'string', description: 'Task ID to update' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'failed'],
              description: 'New status for the task',
            },
            minimal: {
              type: 'boolean',
              description: 'If true, return minimal response (just success) to reduce context size. Default: false',
            },
          },
          required: ['project', 'session', 'taskId', 'status'],
        },
      },
      {
        name: 'update_tasks_status',
        description: 'Update multiple tasks\' statuses in a single call. More efficient than multiple update_task_status calls.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            updates: {
              type: 'array',
              description: 'Array of task updates to apply',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string', description: 'Task ID to update' },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'failed'],
                    description: 'New status for the task',
                  },
                },
                required: ['taskId', 'status'],
              },
            },
            minimal: {
              type: 'boolean',
              description: 'If true, return minimal response (just success and count) to reduce context size. Default: false',
            },
          },
          required: ['project', 'session', 'updates'],
        },
      },
      {
        name: 'get_task_graph',
        description: 'Get the current task graph state without modifications.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
          },
          required: ['project', 'session'],
        },
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

          case 'list_projects': {
            const result = await handleListProjects();
            return JSON.stringify(result, null, 2);
          }

          case 'register_project': {
            const { path } = args as { path: string };
            if (!path) throw new Error('Missing required: path');
            const result = await handleRegisterProject({ path });
            return JSON.stringify(result, null, 2);
          }

          case 'unregister_project': {
            const { path } = args as { path: string };
            if (!path) throw new Error('Missing required: path');
            const result = await handleUnregisterProject({ path });
            return JSON.stringify(result, null, 2);
          }

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

          case 'export_diagram_svg': {
            const { project, session, id, theme } = args as { project: string; session: string; id: string; theme?: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await exportDiagramSVG(project, session, id, theme);
          }

          case 'export_diagram_png': {
            const { project, session, id, theme, scale } = args as { project: string; session: string; id: string; theme?: string; scale?: number };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await exportDiagramPNG(project, session, id, theme, scale);
          }

          case 'get_diagram_history': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const response = await fetch(buildUrl(`/api/diagram/${id}/history`, project, session));
            if (!response.ok) {
              if (response.status === 404) {
                return JSON.stringify({ error: 'No history for diagram', history: null }, null, 2);
              }
              throw new Error(`Failed to get diagram history: ${response.statusText}`);
            }
            const data = await response.json();
            return JSON.stringify(data, null, 2);
          }

          case 'revert_diagram': {
            const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
            if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
            // Get historical content
            const versionResponse = await fetch(buildUrl(`/api/diagram/${id}/version`, project, session, { timestamp }));
            if (!versionResponse.ok) {
              throw new Error(`Failed to get diagram version: ${versionResponse.statusText}`);
            }
            const versionData = await versionResponse.json();
            // Save as current content
            const updateResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: versionData.content }),
            });
            if (!updateResponse.ok) {
              const error = await updateResponse.json();
              throw new Error(`Failed to revert diagram: ${error.error || updateResponse.statusText}`);
            }
            return JSON.stringify({
              success: true,
              id,
              revertedTo: timestamp,
              message: `Diagram reverted to version from ${timestamp}`,
            }, null, 2);
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

          case 'create_wireframe': {
            const { project, session, name, content } = args as { project: string; session: string; name: string; content: any };
            if (!project || !session || !name || !content) throw new Error('Missing required: project, session, name, content');
            const result = await handleCreateWireframe(project, session, name, content);
            return JSON.stringify(result, null, 2);
          }

          case 'update_wireframe': {
            const { project, session, id, content } = args as { project: string; session: string; id: string; content: any };
            if (!project || !session || !id || !content) throw new Error('Missing required: project, session, id, content');
            const result = await handleUpdateWireframe(project, session, id, content);
            return JSON.stringify(result, null, 2);
          }

          case 'get_wireframe': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleGetWireframe(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'list_wireframes': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await handleListWireframes(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'preview_wireframe': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handlePreviewWireframe(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'export_wireframe_svg': {
            const { project, session, id, scale } = args as { project: string; session: string; id: string; scale?: number };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleExportWireframeSVG(project, session, id, scale);
            return JSON.stringify(result, null, 2);
          }

          case 'export_wireframe_png': {
            const { project, session, id, scale } = args as { project: string; session: string; id: string; scale?: number };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleExportWireframePNG(project, session, id, scale);
            return JSON.stringify(result, null, 2);
          }

          case 'validate_wireframe': {
            const { content } = args as { content: any };
            if (!content) throw new Error('Missing required: content');
            const response = await fetch(`${API_BASE_URL}/api/wireframe/validate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            });
            if (!response.ok) {
              throw new Error(`Failed to validate wireframe: ${response.statusText}`);
            }
            const data = await response.json();
            return JSON.stringify(data, null, 2);
          }

          case 'get_wireframe_history': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const response = await fetch(buildUrl(`/api/wireframe/${id}/history`, project, session));
            if (!response.ok) {
              if (response.status === 404) {
                return JSON.stringify({ error: 'No history for wireframe', history: null }, null, 2);
              }
              throw new Error(`Failed to get wireframe history: ${response.statusText}`);
            }
            const data = await response.json();
            return JSON.stringify(data, null, 2);
          }

          case 'revert_wireframe': {
            const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
            if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
            // Get historical content
            const versionResponse = await fetch(buildUrl(`/api/wireframe/${id}/version`, project, session, { timestamp }));
            if (!versionResponse.ok) {
              throw new Error(`Failed to get wireframe version: ${versionResponse.statusText}`);
            }
            const versionData = await versionResponse.json();
            // Save as current content
            const updateResponse = await fetch(buildUrl(`/api/wireframe/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: versionData.content }),
            });
            if (!updateResponse.ok) {
              const error = await updateResponse.json();
              throw new Error(`Failed to revert wireframe: ${error.error || updateResponse.statusText}`);
            }
            return JSON.stringify({
              success: true,
              id,
              revertedTo: timestamp,
              message: `Wireframe reverted to version from ${timestamp}`,
            }, null, 2);
          }

          case 'render_ui': {
            const { project, session, ui, blocking } = args as { project: string; session: string; ui: any; blocking?: boolean };
            if (!project || !session || !ui) throw new Error('Missing required: project, session, ui');

            const response = await fetch(buildUrl('/api/render-ui', project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ui, blocking }),
            });

            if (!response.ok) {
              const error = await response.json();
              throw new Error(`Failed to render UI: ${error.error || response.statusText}`);
            }

            return await response.text();
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

          case 'get_ui_response': {
            const { project, session, uiId } = args as { project: string; session: string; uiId: string };
            if (!project || !session || !uiId) throw new Error('Missing required: project, session, uiId');

            const response = await fetch(
              `${API_BASE_URL}/api/ui-response?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&uiId=${encodeURIComponent(uiId)}`
            );

            if (!response.ok) {
              const error = await response.json();
              throw new Error(`Failed to get UI response: ${error.error || response.statusText}`);
            }

            return await response.text();
          }

          case 'check_server_health': {
            try {
              const response = await fetch(`${API_BASE_URL}/api/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
              });
              if (!response.ok) {
                return JSON.stringify({
                  healthy: false,
                  error: `Health check failed: ${response.statusText}`,
                }, null, 2);
              }
              return await response.text();
            } catch (error) {
              return JSON.stringify({
                healthy: false,
                error: error instanceof Error ? error.message : 'Server not responding',
              }, null, 2);
            }
          }

          case 'get_install_path': {
            // Return the directory where this plugin is installed
            // import.meta.dir gives us the directory of this file (src/mcp/)
            // We need to go up two levels to get the plugin root
            const { dirname, join } = await import('path');
            const pluginRoot = dirname(dirname(dirname(import.meta.path)));
            return JSON.stringify({ path: pluginRoot }, null, 2);
          }

          case 'get_session_state': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const state = await getSessionState(project, session);
            return JSON.stringify(state, null, 2);
          }

          case 'update_session_state': {
            const { project, session, ...updates } = args as {
              project: string;
              session: string;
              phase?: string;
              currentItem?: number | null;
              currentItemType?: 'code' | 'task' | 'bugfix';
              workItems?: Array<{
                number: number;
                title: string;
                type: 'code' | 'task' | 'bugfix';
                status: 'pending' | 'documented';
              }>;
              completedTasks?: string[];
              pendingTasks?: string[];
              totalItems?: number;
              documentedItems?: number;
            };
            if (!project || !session) throw new Error('Missing required: project, session');

            // Register session and project if not already registered
            const sessionResult = await sessionRegistry.register(project, session);
            await projectRegistry.register(project);

            const wsHandler = getWebSocketHandler();

            // Broadcast session_created if this is a new session
            if (sessionResult.created && wsHandler) {
              wsHandler.broadcast({ type: 'session_created', project, session });
            }

            const result = await updateSessionState(project, session, updates, wsHandler || undefined);
            return JSON.stringify(result, null, 2);
          }

          case 'archive_session': {
            const { project, session, delete_session, timestamp } = args as {
              project: string;
              session: string;
              delete_session?: boolean;
              timestamp?: boolean;
            };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await archiveSession(project, session, {
              deleteSession: delete_session,
              timestamp,
            });
            return JSON.stringify(result, null, 2);
          }

          case 'terminal_create_session': {
            const { terminalCreateSession } = await import('./tools/terminal-sessions.js');
            const { project, session, name } = args as { project: string; session: string; name?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await terminalCreateSession(project, session, name);
            return JSON.stringify(result, null, 2);
          }

          case 'terminal_list_sessions': {
            const { terminalListSessions } = await import('./tools/terminal-sessions.js');
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await terminalListSessions(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'terminal_kill_session': {
            const { terminalKillSession } = await import('./tools/terminal-sessions.js');
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await terminalKillSession(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'terminal_rename_session': {
            const { terminalRenameSession } = await import('./tools/terminal-sessions.js');
            const { project, session, id, name } = args as { project: string; session: string; id: string; name: string };
            if (!project || !session || !id || !name) throw new Error('Missing required: project, session, id, name');
            const result = await terminalRenameSession(project, session, id, name);
            return JSON.stringify(result, null, 2);
          }

          case 'terminal_reorder_sessions': {
            const { terminalReorderSessions } = await import('./tools/terminal-sessions.js');
            const { project, session, orderedIds } = args as { project: string; session: string; orderedIds: string[] };
            if (!project || !session || !orderedIds) throw new Error('Missing required: project, session, orderedIds');
            const result = await terminalReorderSessions(project, session, orderedIds);
            return JSON.stringify(result, null, 2);
          }

          // Kodex tools
          case 'kodex_query_topic': {
            const { project, name: topicName, include_content } = args as { project: string; name: string; include_content?: boolean };
            if (!project || !topicName) throw new Error('Missing required: project, name');
            const kodex = getKodexManager(project);
            const topic = await kodex.getTopic(topicName, include_content !== false);
            if (!topic) {
              // Auto-flag missing topics
              const flagResult = await kodex.createFlag(
                topicName,
                'missing',
                'Topic not found when queried',
                { dedupe: true }
              );

              return JSON.stringify({
                found: false,
                error: 'Topic not found',
                flagged: flagResult.created,
                message: flagResult.created
                  ? 'Auto-flagged as missing'
                  : 'Already flagged as missing'
              }, null, 2);
            }
            // Topic found - include hint about flagging
            return JSON.stringify({
              found: true,
              topic,
              hint: 'If this topic is outdated, incorrect, or incomplete, use kodex_flag_topic to report it.'
            }, null, 2);
          }

          case 'kodex_list_topics': {
            const { project, filter } = args as { project: string; filter?: string };
            if (!project) throw new Error('Missing required: project');
            const kodex = getKodexManager(project);
            let topics = await kodex.listTopics();
            if (filter === 'verified') {
              topics = topics.filter(t => t.verified);
            } else if (filter === 'unverified') {
              topics = topics.filter(t => !t.verified);
            } else if (filter === 'has_draft') {
              topics = topics.filter(t => t.hasDraft);
            }
            return JSON.stringify({ topics }, null, 2);
          }

          case 'kodex_create_topic': {
            const { project, name: topicName, title, content } = args as {
              project: string;
              name: string;
              title: string;
              content: TopicContent;
            };
            if (!project || !topicName || !title || !content) throw new Error('Missing required: project, name, title, content');
            const kodex = getKodexManager(project);
            const draft = await kodex.createTopic(topicName, title, content, 'claude');
            return JSON.stringify({ draft, message: 'Draft created. Requires human approval.' }, null, 2);
          }

          case 'kodex_update_topic': {
            const { project, name: topicName, content, reason } = args as {
              project: string;
              name: string;
              content: Partial<TopicContent>;
              reason: string;
            };
            if (!project || !topicName || !content || !reason) throw new Error('Missing required: project, name, content, reason');
            const kodex = getKodexManager(project);
            const draft = await kodex.updateTopic(topicName, content, reason);
            return JSON.stringify({ draft, message: 'Draft created. Requires human approval.' }, null, 2);
          }

          case 'kodex_flag_topic': {
            const { project, name: topicName, type, description } = args as {
              project: string;
              name: string;
              type: FlagType;
              description: string;
            };
            if (!project || !topicName || !type || !description) throw new Error('Missing required: project, name, type, description');
            const kodex = getKodexManager(project);
            const flag = await kodex.createFlag(topicName, type, description);
            return JSON.stringify({ flag }, null, 2);
          }

          case 'kodex_verify_topic': {
            const { project, name: topicName, verified_by } = args as { project: string; name: string; verified_by: string };
            if (!project || !topicName || !verified_by) throw new Error('Missing required: project, name, verified_by');
            const kodex = getKodexManager(project);
            await kodex.verifyTopic(topicName, verified_by);
            const topic = await kodex.getTopic(topicName, false);
            return JSON.stringify({ topic, message: 'Topic verified' }, null, 2);
          }

          case 'kodex_list_drafts': {
            const { project, include_content } = args as { project: string; include_content?: boolean };
            if (!project) throw new Error('Missing required: project');
            const kodex = getKodexManager(project);
            if (include_content) {
              const drafts = await kodex.listDrafts();
              return JSON.stringify({ drafts }, null, 2);
            } else {
              const drafts = await kodex.listDraftsSummary();
              return JSON.stringify({ drafts }, null, 2);
            }
          }

          case 'kodex_approve_draft': {
            const { project, name: topicName } = args as { project: string; name: string };
            if (!project || !topicName) throw new Error('Missing required: project, name');
            const kodex = getKodexManager(project);
            const topic = await kodex.approveDraft(topicName);
            return JSON.stringify({ topic, message: 'Draft approved and published' }, null, 2);
          }

          case 'kodex_reject_draft': {
            const { project, name: topicName } = args as { project: string; name: string };
            if (!project || !topicName) throw new Error('Missing required: project, name');
            const kodex = getKodexManager(project);
            await kodex.rejectDraft(topicName);
            return JSON.stringify({ message: 'Draft rejected' }, null, 2);
          }

          case 'kodex_dashboard': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const kodex = getKodexManager(project);
            const stats = await kodex.getDashboardStats();
            return JSON.stringify(stats, null, 2);
          }

          case 'kodex_list_flags': {
            const { project, status } = args as { project: string; status?: 'open' | 'resolved' | 'dismissed' };
            if (!project) throw new Error('Missing required: project');
            const kodex = getKodexManager(project);
            const flags = await kodex.listFlags(status);
            return JSON.stringify({ flags }, null, 2);
          }

          case 'kodex_add_alias': {
            const { project, topicName, alias } = args as { project: string; topicName: string; alias: string };
            if (!project || !topicName || !alias) throw new Error('Missing required: project, topicName, alias');
            const kodex = getKodexManager(project);
            kodex.addAlias(topicName, alias);
            return JSON.stringify({ success: true, message: `Alias '${alias}' added to topic '${topicName}' successfully` }, null, 2);
          }

          case 'kodex_remove_alias': {
            const { project, topicName, alias } = args as { project: string; topicName: string; alias: string };
            if (!project || !topicName || !alias) throw new Error('Missing required: project, topicName, alias');
            const kodex = getKodexManager(project);
            kodex.removeAlias(topicName, alias);
            return JSON.stringify({ success: true, message: `Alias '${alias}' removed from topic '${topicName}' successfully` }, null, 2);
          }

          case 'complete_skill': {
            const { project, session, skill } = args as { project: string; session: string; skill: string };
            if (!project || !session || !skill) throw new Error('Missing required: project, session, skill');
            const result = await completeSkill(project, session, skill);
            return JSON.stringify(result, null, 2);
          }

          case 'update_task_status': {
            const { project, session, taskId, status, minimal } = args as {
              project: string;
              session: string;
              taskId: string;
              status: 'pending' | 'in_progress' | 'completed' | 'failed';
              minimal?: boolean;
            };
            if (!project || !session || !taskId || !status) throw new Error('Missing required: project, session, taskId, status');
            const wsHandler = getWebSocketHandler();
            const result = await updateTaskStatus({ project, session, taskId, status, minimal }, wsHandler || undefined);
            return JSON.stringify(result, null, 2);
          }

          case 'update_tasks_status': {
            const { project, session, updates, minimal } = args as {
              project: string;
              session: string;
              updates: Array<{ taskId: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }>;
              minimal?: boolean;
            };
            if (!project || !session || !updates || updates.length === 0) throw new Error('Missing required: project, session, updates (non-empty array)');
            const wsHandler = getWebSocketHandler();
            const result = await updateTasksStatus({ project, session, updates, minimal }, wsHandler || undefined);
            return JSON.stringify(result, null, 2);
          }

          case 'get_task_graph': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await getTaskGraph({ project, session });
            return JSON.stringify(result, null, 2);
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

  return server;
}
