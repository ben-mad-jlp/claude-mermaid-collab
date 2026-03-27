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
  addLesson,
  listLessons,
  addLessonSchema,
  listLessonsSchema,
} from './tools/lessons.js';
import {
  listTodos,
  addTodo,
  removeTodo,
  updateTodo,
  listTodosSchema,
  addTodoSchema,
  removeTodoSchema,
  updateTodoSchema,
  listTodoItemsSchema,
} from './tools/todos.js';
import {
  handleCreateDesign,
  handleUpdateDesign,
  handleGetDesign,
  handleListDesigns,
  handleDeleteDesign,
  handleExportDesign,
  createDesignSchema,
  updateDesignSchema,
  getDesignSchema,
  listDesignsSchema,
  deleteDesignSchema,
  exportDesignSchema,
} from './tools/design.js';
import {
  addDesignNodeSchema,
  updateDesignNodeSchema,
  removeDesignNodeSchema,
  batchDesignOperationsSchema,
  getDesignNodeSchema,
  listDesignNodesSchema,
  groupDesignNodesSchema,
  ungroupDesignNodesSchema,
  reorderDesignNodesSchema,
  duplicateDesignNodesSchema,
  alignDesignNodesSchema,
  transformDesignNodesSchema,
  handleAddDesignNode,
  handleUpdateDesignNode,
  handleRemoveDesignNode,
  handleBatchDesignOperations,
  handleGetDesignNode,
  handleListDesignNodes,
  handleGroupDesignNodes,
  handleUngroupDesignNodes,
  handleReorderDesignNodes,
  handleDuplicateDesignNodes,
  handleAlignDesignNodes,
  handleTransformDesignNodes,
  createDesignFromTreeSchema,
  addDesignImageSchema,
  setNodeImageSchema,
  exportDesignSvgSchema,
  exportDesignCodeSchema,
  handleCreateDesignFromTree,
  handleAddDesignImage,
  handleSetNodeImage,
  handleExportDesignSvg,
  handleExportDesignCode,
  validateAndFixGraph,
  isTreeSpec,
  treeToGraph,
  getGraph,
  annotateNodeSchema,
  getAnnotationsSchema,
  removeAnnotationSchema,
  handleAnnotateNode,
  handleGetAnnotations,
  handleRemoveAnnotation,
  describeDesignSchema,
  handleDescribeDesign,
  lintDesignSchema,
  handleLintDesign,
  describeDesignChangesSchema,
  computeDesignDiff,
  createComponentSchema,
  createInstanceSchema,
  listComponentsSchema,
  detachInstanceSchema,
  saveComponentSchema,
  loadComponentSchema,
  listLibraryComponentsSchema,
  handleCreateComponent,
  handleCreateInstance,
  handleListComponents,
  handleDetachInstance,
  handleSaveComponent,
  handleLoadComponent,
  handleListLibraryComponents,
  designToDiagramSchema,
  handleDesignToDiagram,
} from './tools/design-ai.js';
import {
  createFromTemplateSchema,
  createDesignTokensSchema,
  applyDesignTokensSchema,
  handleCreateFromTemplate,
  handleCreateDesignTokens,
  handleApplyDesignTokens,
} from './tools/design-templates.js';
import {
  diagramFromCodeSchema,
  handleDiagramFromCode,
} from './tools/diagram-codegen.js';
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
  handleApplySnippet,
  applySnippetSchema,
} from './tools/snippet.js';

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

function extractDesignItem(content: string, itemNumber: number): { itemText: string; startIndex: number; endIndex: number; itemCount: number } {
  const itemPattern = /^### Item \d+:/gm;
  const matches: { index: number }[] = [];
  let match;
  while ((match = itemPattern.exec(content)) !== null) {
    matches.push({ index: match.index });
  }

  const itemCount = matches.length;
  if (itemCount === 0) {
    throw new Error('No work items found in document. Expected headings like "### Item 1: Title".');
  }
  if (itemNumber < 1 || itemNumber > itemCount) {
    throw new Error(`Item number ${itemNumber} out of range. Document has ${itemCount} item(s).`);
  }

  const itemIndex = itemNumber - 1;
  const startIndex = matches[itemIndex].index;

  let endIndex: number;
  if (itemIndex + 1 < matches.length) {
    // End at next item heading
    endIndex = matches[itemIndex + 1].index;
  } else {
    // Last item: end at next ## heading or EOF
    const nextSectionPattern = /^## /gm;
    nextSectionPattern.lastIndex = startIndex + 1;
    const nextSection = nextSectionPattern.exec(content);
    endIndex = nextSection ? nextSection.index : content.length;
  }

  let itemText = content.slice(startIndex, endIndex);
  // Trim trailing --- separators and whitespace
  itemText = itemText.replace(/\n---\s*$/, '').trimEnd();

  return { itemText, startIndex, endIndex, itemCount };
}

async function getDesignItem(project: string, session: string, id: string, itemNumber: number): Promise<string> {
  const response = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }
  const data = await response.json();
  const { itemText, itemCount } = extractDesignItem(data.content, itemNumber);

  return JSON.stringify({
    item_number: itemNumber,
    item_count: itemCount,
    content: itemText,
  }, null, 2);
}

async function patchDesignItem(project: string, session: string, id: string, itemNumber: number, oldString: string, newString: string): Promise<string> {
  const getResponse = await fetch(buildUrl(`/api/document/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${getResponse.statusText}`);
  }
  const docData = await getResponse.json();
  const fullContent = docData.content;

  const { itemText, startIndex, endIndex } = extractDesignItem(fullContent, itemNumber);

  const occurrences = itemText.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in item ${itemNumber}. The text you're trying to replace does not exist within this item.`);
  }
  if (occurrences > 1) {
    throw new Error(`old_string matches ${occurrences} locations in item ${itemNumber}. Provide more context to make it unique.`);
  }

  const patchedItem = itemText.replace(oldString, newString);
  const updatedContent = fullContent.slice(0, startIndex) + patchedItem + fullContent.slice(startIndex + itemText.length);

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

  const changeIndex = patchedItem.indexOf(newString);
  const previewStart = Math.max(0, changeIndex - 50);
  const previewEnd = Math.min(patchedItem.length, changeIndex + newString.length + 50);
  const preview = patchedItem.slice(previewStart, previewEnd);

  return JSON.stringify({
    success: true,
    id,
    item_number: itemNumber,
    message: `Item ${itemNumber} patched successfully`,
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

async function patchSnippet(project: string, session: string, id: string, startLine: number, endLine: number, newContent: string): Promise<string> {
  const getResponse = await fetch(buildUrl(`/api/snippet/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Snippet not found: ${id}`);
    }
    throw new Error(`Failed to get snippet: ${getResponse.statusText}`);
  }

  const snippetData = await getResponse.json();
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

  const updateResponse = await fetch(buildUrl(`/api/snippet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: updatedContent }),
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to patch snippet: ${error.error || updateResponse.statusText}`);
  }

  return JSON.stringify({
    success: true,
    id,
    message: `Snippet patched: replaced ${linesReplaced!} line(s) at ${startLine}–${endLine} with ${newContent.split('\n').length} line(s)`,
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

// ============= Spreadsheet Tools =============

async function listSpreadsheets(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/spreadsheets', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list spreadsheets: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function getSpreadsheet(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Spreadsheet not found: ${id}`);
    }
    throw new Error(`Failed to get spreadsheet: ${response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

async function createSpreadsheet(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/spreadsheet', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create spreadsheet: ${error.error || response.statusText}`);
  }
  const data = await response.json();
  return JSON.stringify({
    success: true,
    id: data.id,
    message: 'Spreadsheet created successfully',
  }, null, 2);
}

async function updateSpreadsheet(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update spreadsheet: ${error.error || response.statusText}`);
  }
  return JSON.stringify({ success: true, id, message: 'Spreadsheet updated successfully' }, null, 2);
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
      description: 'Session name (e.g., "bright-calm-river"). Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
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
          required: ['project'],
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
          required: ['project', 'id'],
        },
      },
      {
        name: 'create_diagram',
        description: `Create a new Mermaid diagram. Returns the diagram ID and preview URL.

IMPORTANT - Common pitfalls to avoid:
- State diagrams: Do NOT place 'note right of X' inside state X itself (creates cycle)
- State diagrams: Notes must reference states from outside, not inside composite states
- Flowcharts: Use HTML entities for special chars in labels (e.g., &amp; for &)
- All types: Avoid colons in node IDs (they're interpreted as aliases)
- Test complex diagrams with validate_diagram first`,
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Diagram name (without .mmd extension)' },
            content: { type: 'string', description: 'Mermaid diagram syntax' },
          },
          required: ['project', 'name', 'content'],
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
          required: ['project', 'id', 'content'],
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
          required: ['project', 'id'],
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
          required: ['project', 'id'],
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
          required: ['project', 'id'],
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
          required: ['project', 'id'],
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
          required: ['project', 'id'],
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
          required: ['project', 'id', 'timestamp'],
        },
      },
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
      // Design-to-Diagram
      {
        name: 'design_to_diagram',
        description: 'Generate a Mermaid diagram from a design\'s scene graph showing the node hierarchy. Creates a new diagram in the session.',
        inputSchema: designToDiagramSchema,
      },
      // Diagram from Code
      {
        name: 'diagram_from_code',
        description: 'Parse source files to generate a Mermaid diagram. Supports class (class hierarchy), dependency (import graph), and module (directory grouping) diagrams.',
        inputSchema: diagramFromCodeSchema,
      },
      // Session Summary
      {
        name: 'generate_session_summary',
        description: 'Generate a markdown document summarizing all artifacts (diagrams, documents, designs, spreadsheets) in the current session.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            documentName: { type: 'string', description: 'Name for the summary document (default: "Session Summary")' },
          },
          required: ['project'],
        },
      },
      // Cross-Artifact Link Validation
      {
        name: 'validate_session_links',
        description: 'Scan all documents in a session for artifact references ({{diagram:id}}, {{design:id}}, {{spreadsheet:id}}) and validate that referenced artifacts exist.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project'],
        },
      },
      {
        name: 'get_design_item',
        description: 'Read a single work item from a design document by item number. Returns just that item\'s markdown section. Items are headed "### Item N: Title".',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID (defaults to "design")', default: 'design' },
            item_number: { type: 'integer', description: 'The item number to read (1-based)' },
          },
          required: ['project', 'item_number'],
        },
      },
      {
        name: 'patch_design_item',
        description: 'Patch a specific work item in a design document. Scopes the search-replace to just that item\'s section, so old_string only needs to be unique within the item.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The document ID (defaults to "design")', default: 'design' },
            item_number: { type: 'integer', description: 'The item number to patch (1-based)' },
            old_string: { type: 'string', description: 'Text to find (must be unique within the item)' },
            new_string: { type: 'string', description: 'Text to replace with' },
          },
          required: ['project', 'item_number', 'old_string', 'new_string'],
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
          required: ['project', 'id', 'old_string', 'new_string'],
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
      {
        name: 'create_design',
        description: 'Create a new design. Returns the design ID. Content must be a scene graph with a CANVAS root node containing PAGE child(ren). If a bare PAGE is passed as root, it will be auto-wrapped in a CANVAS. Prefer using create_design_from_tree or create_from_template instead of constructing raw JSON.',
        inputSchema: createDesignSchema,
      },
      {
        name: 'update_design',
        description: 'Update an existing design\'s content. Content must be a valid scene graph with CANVAS root → PAGE children. Prefer using add_design_node, update_design_node, or batch_design_operations for incremental edits.',
        inputSchema: updateDesignSchema,
      },
      {
        name: 'get_design',
        description: 'Read a design\'s content by ID.',
        inputSchema: getDesignSchema,
      },
      {
        name: 'list_designs',
        description: 'List all designs in a session.',
        inputSchema: listDesignsSchema,
      },
      {
        name: 'delete_design',
        description: 'Delete a design by ID.',
        inputSchema: deleteDesignSchema,
      },
      {
        name: 'get_design_history',
        description: 'Get the change history for a design. Returns original content and list of changes with timestamps.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Design ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'revert_design',
        description: 'Revert a design to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Design ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'id', 'timestamp'],
        },
      },
      {
        name: 'add_design_node',
        description: 'Add a shape, text, or frame node to a design. Returns the new node ID. Layout properties: layoutMode (HORIZONTAL/VERTICAL), primaryAxisAlign (MIN/CENTER/MAX/SPACE_BETWEEN), counterAxisAlign (MIN/CENTER/MAX/STRETCH), primaryAxisSizing/counterAxisSizing (FIXED/HUG/FILL), itemSpacing, padding, layoutGrow (0=fixed, 1=fill), layoutAlignSelf (AUTO/STRETCH), clipsContent. Visual: fill, stroke, position, size, cornerRadius, opacity, rotation, textAlignHorizontal.',
        inputSchema: addDesignNodeSchema,
      },
      {
        name: 'update_design_node',
        description: 'Update properties of a node in a design. Layout: layoutMode, primaryAxisAlign (MIN/CENTER/MAX/SPACE_BETWEEN), counterAxisAlign (MIN/CENTER/MAX/STRETCH), primaryAxisSizing/counterAxisSizing (FIXED/HUG/FILL), itemSpacing, padding, layoutGrow, layoutAlignSelf (AUTO/STRETCH), clipsContent. Visual: x, y, width, height, fill, stroke, text, fontSize, fontWeight, cornerRadius, opacity, rotation, textAlignHorizontal.',
        inputSchema: updateDesignNodeSchema,
      },
      {
        name: 'remove_design_node',
        description: 'Remove a node and all its children from a design.',
        inputSchema: removeDesignNodeSchema,
      },
      {
        name: 'batch_design_operations',
        description: 'Apply multiple add/update/remove operations to a design in a single call. Supports temp IDs for referencing nodes created in earlier operations within the same batch. Same layout properties as add/update_design_node: primaryAxisAlign, counterAxisAlign, primaryAxisSizing, counterAxisSizing, layoutGrow, layoutAlignSelf, etc.',
        inputSchema: batchDesignOperationsSchema,
      },
      {
        name: 'get_design_node',
        description: 'Inspect a single node\'s full properties by ID. Returns all properties including position, size, fills, strokes, text, layout, etc.',
        inputSchema: getDesignNodeSchema,
      },
      {
        name: 'list_design_nodes',
        description: 'List all nodes in a design as a tree. Returns id, name, type, bounds, depth, and child count for each node.',
        inputSchema: listDesignNodesSchema,
      },
      {
        name: 'group_design_nodes',
        description: 'Group multiple nodes into a GROUP container. All nodes must share the same parent.',
        inputSchema: groupDesignNodesSchema,
      },
      {
        name: 'ungroup_design_nodes',
        description: 'Ungroup a GROUP node, reparenting its children to the group\'s parent.',
        inputSchema: ungroupDesignNodesSchema,
      },
      {
        name: 'reorder_design_nodes',
        description: 'Change z-order of nodes: front, back, forward (one step up), or backward (one step down).',
        inputSchema: reorderDesignNodesSchema,
      },
      {
        name: 'duplicate_design_nodes',
        description: 'Deep-clone nodes with an optional position offset. Returns the new node IDs.',
        inputSchema: duplicateDesignNodesSchema,
      },
      {
        name: 'align_design_nodes',
        description: 'Align or distribute nodes. Alignment: left, centerH, right, top, centerV, bottom. Distribution: distributeH, distributeV (equal spacing).',
        inputSchema: alignDesignNodesSchema,
      },
      {
        name: 'transform_design_nodes',
        description: 'Transform nodes: flip horizontally (flipH) or vertically (flipV). Mirrors positions within selection bounding box.',
        inputSchema: transformDesignNodesSchema,
      },
      {
        name: 'create_design_from_tree',
        description: 'Create an entire node hierarchy from a single recursive tree spec. Each node: { type, name?, fill?, children?: [...], ref?: "name", ...props }. Returns a map of ref/name→nodeId. Far more efficient than multiple add_design_node calls.',
        inputSchema: createDesignFromTreeSchema,
      },
      {
        name: 'add_design_image',
        description: 'Add an image node to a design from a URL, file path, or base64 data. Creates a FRAME with an IMAGE fill.',
        inputSchema: addDesignImageSchema,
      },
      {
        name: 'set_node_image',
        description: 'Set or replace the image fill on an existing node. Loads from URL, file path, or base64.',
        inputSchema: setNodeImageSchema,
      },
      {
        name: 'export_design_svg',
        description: 'Export a design or node subtree as SVG. Renders fills, strokes, text, images, corners, opacity, rotation, and clipping server-side. Optionally saves to file.',
        inputSchema: exportDesignSvgSchema,
      },
      {
        name: 'export_design_code',
        description: 'Export a design as React or HTML code. Converts layout to CSS flexbox, fills to background-color, strokes to border. Params: framework (react/html).',
        inputSchema: exportDesignCodeSchema,
      },
      {
        name: 'create_from_template',
        description: 'Create a UI component from a template. Available: navbar, card, button, input, list-item, avatar, badge, modal, tab-bar, form. Each accepts customization params (title, fill, width, items, etc.).',
        inputSchema: createFromTemplateSchema,
      },
      {
        name: 'create_design_tokens',
        description: 'Create design token variables (colors, typography, spacing, radii) from a preset (material, ios, minimal-dark, minimal-light) or custom token set.',
        inputSchema: createDesignTokensSchema,
      },
      {
        name: 'apply_design_tokens',
        description: 'Bind design token variables to node properties. Maps property names to variable names (e.g. { "fills/0/color": "color/primary" }).',
        inputSchema: applyDesignTokensSchema,
      },
      {
        name: 'export_design_png',
        description: 'Export a design as an image (PNG, JPG, or WEBP). Requires the design to be open in a browser. The browser renders the design via CanvasKit and returns the image. Returns the file path of the saved image.',
        inputSchema: exportDesignSchema,
      },
      // Design Annotations
      {
        name: 'annotate_node',
        description: 'Add or update an annotation on a design node. Annotations store intent, notes, and status (placeholder/final/needs-review) for AI-human collaboration.',
        inputSchema: annotateNodeSchema,
      },
      {
        name: 'get_annotations',
        description: 'List all annotations in a design. Optionally filter by status (placeholder/final/needs-review).',
        inputSchema: getAnnotationsSchema,
      },
      {
        name: 'remove_annotation',
        description: 'Remove an annotation from a design node.',
        inputSchema: removeAnnotationSchema,
      },
      // Visual Feedback
      {
        name: 'describe_design',
        description: 'Analyze a design and return a text description of the node tree with positions, sizes, colors, text, layout, detected issues (zero-size, outside bounds, off-screen), and stats. Modes: full (all nodes) or summary (top 2 levels + stats).',
        inputSchema: describeDesignSchema,
      },
      // Design Linting
      {
        name: 'lint_design',
        description: 'Lint a design for common issues: zero-size nodes, nodes outside parent bounds, text overflow, missing fills, overlapping siblings, orphaned nodes, low contrast text.',
        inputSchema: lintDesignSchema,
      },
      // Design Diff
      {
        name: 'describe_design_changes',
        description: 'Compare current design state against a previous version. Returns added, removed, and modified nodes with property-level diffs. Uses design history; optionally specify a "since" timestamp.',
        inputSchema: describeDesignChangesSchema,
      },
      // Component Library
      {
        name: 'create_component',
        description: 'Convert a FRAME node to a COMPONENT type, making it reusable via create_instance.',
        inputSchema: createComponentSchema,
      },
      {
        name: 'create_instance',
        description: 'Create an INSTANCE of a COMPONENT. Deep-clones the component subtree with new IDs and sets componentId reference.',
        inputSchema: createInstanceSchema,
      },
      {
        name: 'list_components',
        description: 'List all COMPONENT nodes in a design with their instance counts.',
        inputSchema: listComponentsSchema,
      },
      {
        name: 'detach_instance',
        description: 'Detach an INSTANCE from its component, converting it back to a regular FRAME.',
        inputSchema: detachInstanceSchema,
      },
      {
        name: 'save_component',
        description: 'Save a COMPONENT subtree to the component library (persistent file storage). Can be loaded into any design later.',
        inputSchema: saveComponentSchema,
      },
      {
        name: 'load_component',
        description: 'Load a saved component from the library into a design. Remaps all IDs to avoid conflicts.',
        inputSchema: loadComponentSchema,
      },
      {
        name: 'list_library_components',
        description: 'Browse saved components in the component library.',
        inputSchema: listLibraryComponentsSchema,
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
        description: 'Get current collab session state (state, currentItem, etc.)',
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
            useRenderUI: { type: 'boolean', description: 'Whether to use browser UI for questions (default: true). Set to false for console-based questions.' },
            sessionType: { type: 'string', enum: ['structured', 'vibe'], description: 'Session type: structured (guided) or vibe (freeform)' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'archive_session',
        description: 'Archive a collab session by copying documents, diagrams, designs, and spreadsheets to docs/designs/[session]/ and optionally deleting the session folder.',
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
            type: { type: 'string', enum: ['outdated', 'incorrect', 'incomplete', 'missing', 'needs-review'], description: 'Flag type' },
            description: { type: 'string', description: 'Description of the issue' },
          },
          required: ['project', 'name', 'type', 'description'],
        },
      },
      {
        name: 'kodex_direct_update_topic',
        description: 'Update an existing topic directly (bypasses draft). Writes to live files and flags as needs-review.',
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
                diagrams: { type: 'string', description: 'Diagrams section' },
              },
            },
            reason: { type: 'string', description: 'Reason for the update' },
          },
          required: ['project', 'name', 'content', 'reason'],
        },
      },
      {
        name: 'kodex_direct_create_topic',
        description: 'Create a new topic directly (bypasses draft). Writes to live files with confidence=medium and flags as needs-review.',
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
                diagrams: { type: 'string', description: 'Diagrams section' },
              },
              required: ['conceptual', 'technical', 'files', 'related'],
            },
            reason: { type: 'string', description: 'Reason for creation' },
          },
          required: ['project', 'name', 'title', 'content', 'reason'],
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
      // Lessons tools
      {
        name: 'add_lesson',
        description: 'Record a lesson learned during the session. Creates LESSONS.md if it doesn\'t exist.',
        inputSchema: addLessonSchema,
      },
      {
        name: 'list_lessons',
        description: 'Get all lessons from a session.',
        inputSchema: listLessonsSchema,
      },
      // Todos tools
      {
        name: 'list_todos',
        description: 'List all project-level todos.',
        inputSchema: listTodosSchema,
      },
      {
        name: 'add_todo',
        description: 'Add a project-level todo.',
        inputSchema: addTodoSchema,
      },
      {
        name: 'remove_todo',
        description: 'Remove a project-level todo by ID.',
        inputSchema: removeTodoSchema,
      },
      {
        name: 'update_todo',
        description: 'Update a project-level todo title.',
        inputSchema: updateTodoSchema,
      },
      {
        name: 'list_todo_items',
        description: 'List all diagrams, documents, designs, and spreadsheets for a specific todo.',
        inputSchema: listTodoItemsSchema,
      },
      // Spreadsheet tools
      {
        name: 'list_spreadsheets',
        description: 'List all spreadsheets in a session.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project'],
        },
      },
      {
        name: 'get_spreadsheet',
        description: 'Read a spreadsheet\'s content by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'create_spreadsheet',
        description: 'Create a new spreadsheet with columns and rows. Columns have types: text, number, boolean, date. Rows use column names as keys.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            name: { type: 'string', description: 'Spreadsheet name' },
            columns: {
              type: 'array',
              description: 'Column definitions',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Column header label' },
                  type: { type: 'string', enum: ['text', 'number', 'boolean', 'date'], description: 'Data type' },
                  width: { type: 'number', description: 'Column width in pixels (optional)' },
                },
                required: ['name', 'type'],
              },
            },
            rows: {
              type: 'array',
              description: 'Row data as objects with column names as keys',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          required: ['project', 'name', 'columns'],
        },
      },
      {
        name: 'update_spreadsheet',
        description: 'Replace a spreadsheet\'s entire content with new JSON data.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'The spreadsheet ID' },
            content: { type: 'string', description: 'Full SpreadsheetData JSON string' },
          },
          required: ['project', 'id', 'content'],
        },
      },
      {
        name: 'delete_spreadsheet',
        description: 'Delete a spreadsheet by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'get_spreadsheet_history',
        description: 'Get the change history for a spreadsheet.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
      {
        name: 'revert_spreadsheet',
        description: 'Revert a spreadsheet to a specific historical version by timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
            timestamp: { type: 'string', description: 'ISO timestamp of the version to revert to' },
          },
          required: ['project', 'id', 'timestamp'],
        },
      },
      {
        name: 'patch_spreadsheet',
        description: 'Apply incremental edits to a spreadsheet without replacing the entire content. Supports add/update/delete rows, add/delete/rename columns, and set aggregates.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
            operations: {
              type: 'array',
              description: 'List of operations to apply',
              items: {
                type: 'object',
                properties: {
                  op: {
                    type: 'string',
                    enum: ['add_row', 'update_row', 'delete_row', 'add_column', 'delete_column', 'rename_column', 'set_aggregate'],
                    description: 'Operation type',
                  },
                  rowId: { type: 'string', description: 'Row ID (for update_row, delete_row)' },
                  cells: { type: 'object', additionalProperties: true, description: 'Cell values keyed by column name (for add_row, update_row)' },
                  columnId: { type: 'string', description: 'Column ID (for delete_column, rename_column, set_aggregate)' },
                  name: { type: 'string', description: 'Column name (for add_column, rename_column)' },
                  type: { type: 'string', enum: ['text', 'number', 'boolean', 'date'], description: 'Column type (for add_column)' },
                  defaultValue: { description: 'Default value for new column cells' },
                  function: { type: 'string', enum: ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'], description: 'Aggregate function (for set_aggregate)' },
                },
                required: ['op'],
              },
            },
          },
          required: ['project', 'id', 'operations'],
        },
      },
      {
        name: 'export_spreadsheet_csv',
        description: 'Export a spreadsheet as CSV text.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            id: { type: 'string', description: 'Spreadsheet ID' },
          },
          required: ['project', 'id'],
        },
      },
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
        name: 'apply_snippet',
        description: 'Apply a snippet back to its source file on disk. Writes the code field to filePath. Supports line-range writes if startLine/endLine were set during creation.',
        inputSchema: applySnippetSchema,
      },
      {
        name: 'patch_snippet',
        description: 'Replace a range of lines in a snippet. Call get_snippet first — it returns a numberedContent field showing each line with its 1-indexed line number so you can identify startLine/endLine precisely.',
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
    ],
  }));

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      // Resolve todoId → session
      if (args?.todoId && !args?.session) {
        const todosResult = await listTodos(args.project as string);
        const todo = todosResult.todos.find(t => t.id === (args.todoId as number));
        if (!todo) throw new Error(`Todo with id ${args.todoId} not found`);
        (args as any).session = todo.sessionName;
      }

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
            const data = await response.json();
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

          // Design-to-Diagram
          case 'design_to_diagram': {
            const { project, session, designId, maxDepth, style } = args as { project: string; session: string; designId: string; maxDepth?: number; style?: 'tree' | 'component-map' };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleDesignToDiagram(project, session, designId, maxDepth, style);
            const diagramName = `${designId}-structure`;
            const diagramResult = await createDiagram(project, session, diagramName, result.mermaidSource);
            const parsed = JSON.parse(diagramResult);
            return JSON.stringify({
              success: true,
              diagramId: parsed.id,
              mermaidSource: result.mermaidSource,
              previewUrl: parsed.previewUrl,
              message: parsed.message,
            }, null, 2);
          }

          // Diagram from Code
          case 'diagram_from_code': {
            const { project, session, filePaths, diagramType, diagramName } = args as { project: string; session: string; filePaths: string[]; diagramType: 'class' | 'dependency' | 'module'; diagramName?: string };
            if (!project || !session || !filePaths || !diagramType) throw new Error('Missing required: project, session, filePaths, diagramType');
            const result = await handleDiagramFromCode(project, filePaths, diagramType);
            const name = diagramName || `${diagramType}-diagram`;
            const diagramResult = await createDiagram(project, session, name, result.mermaidSource);
            const parsed = JSON.parse(diagramResult);
            return JSON.stringify({
              success: true,
              diagramId: parsed.id,
              mermaidSource: result.mermaidSource,
              previewUrl: parsed.previewUrl,
              message: parsed.message,
            }, null, 2);
          }

          // Session Summary
          case 'generate_session_summary': {
            const { project, session, documentName } = args as { project: string; session: string; documentName?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const [diagramsRaw, documentsRaw, designsResult, spreadsheetsRaw] = await Promise.all([
              listDiagrams(project, session).catch(() => '[]'),
              listDocuments(project, session).catch(() => '[]'),
              handleListDesigns(project, session).catch(() => ({ designs: [], count: 0 })),
              listSpreadsheets(project, session).catch(() => '{"spreadsheets":[]}'),
            ]);
            const diagrams = JSON.parse(diagramsRaw);
            const documents = JSON.parse(documentsRaw);
            const designs = designsResult.designs || [];
            const spreadsheetsList = JSON.parse(spreadsheetsRaw).spreadsheets || [];

            const lines: string[] = ['# Session Summary', ''];
            lines.push(`**Session:** ${session}  `);
            lines.push(`**Generated:** ${new Date().toISOString()}`, '');

            if (diagrams.length > 0) {
              lines.push('## Diagrams', '');
              for (const d of diagrams) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (documents.length > 0) {
              lines.push('## Documents', '');
              for (const d of documents) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (designs.length > 0) {
              lines.push('## Designs', '');
              for (const d of designs) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (spreadsheetsList.length > 0) {
              lines.push('## Spreadsheets', '');
              for (const s of spreadsheetsList) {
                lines.push(`- **${s.name || s.id}** (id: \`${s.id}\`)${s.lastModified ? ` — last modified: ${s.lastModified}` : ''}`);
              }
              lines.push('');
            }

            lines.push('---', '');
            lines.push(`**Totals:** ${diagrams.length} diagram(s), ${documents.length} document(s), ${designs.length} design(s), ${spreadsheetsList.length} spreadsheet(s)`);

            const markdown = lines.join('\n');
            const summaryName = documentName || 'Session Summary';
            return await createDocument(project, session, summaryName, markdown);
          }

          // Cross-Artifact Link Validation
          case 'validate_session_links': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');

            const [diagramsRaw, documentsRaw, designsResult, spreadsheetsRaw] = await Promise.all([
              listDiagrams(project, session).catch(() => '[]'),
              listDocuments(project, session).catch(() => '[]'),
              handleListDesigns(project, session).catch(() => ({ designs: [], count: 0 })),
              listSpreadsheets(project, session).catch(() => '[]'),
            ]);
            const diagrams = JSON.parse(diagramsRaw);
            const documents = JSON.parse(documentsRaw);
            const designs = designsResult.designs || [];
            const spreadsheets = JSON.parse(spreadsheetsRaw);

            // Build ID sets
            const diagramIds = new Set(diagrams.map((d: any) => d.id));
            const documentIds = new Set(documents.map((d: any) => d.id));
            const designIds = new Set(designs.map((d: any) => d.id));
            const spreadsheetIds = new Set(spreadsheets.map((d: any) => d.id));

            const valid: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];
            const broken: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];

            // Read each document and scan for references
            for (const doc of documents) {
              try {
                const docContent = await getDocument(project, session, doc.id);
                const parsed = JSON.parse(docContent);
                const content = parsed.content || '';

                // Scan for {{diagram:id}}, {{design:id}}, {{spreadsheet:id}} patterns
                const embedRegex = /\{\{(diagram|design|spreadsheet):([^}]+)\}\}/g;
                let match: RegExpExecArray | null;
                while ((match = embedRegex.exec(content)) !== null) {
                  const targetType = match[1];
                  const targetId = match[2];
                  const ref = match[0];
                  const idSet = targetType === 'diagram' ? diagramIds : targetType === 'spreadsheet' ? spreadsheetIds : designIds;
                  const exists = idSet.has(targetId);
                  (exists ? valid : broken).push({ docId: doc.id, ref, targetType, targetId });
                }

                // Also scan for @diagram/id, @design/id, @spreadsheet/id patterns (image embeds)
                const imgRegex = /@(diagram|design|spreadsheet)\/([^\s)]+)/g;
                while ((match = imgRegex.exec(content)) !== null) {
                  const targetType = match[1];
                  const targetId = match[2];
                  const ref = match[0];
                  const idSet = targetType === 'diagram' ? diagramIds : targetType === 'spreadsheet' ? spreadsheetIds : designIds;
                  const exists = idSet.has(targetId);
                  (exists ? valid : broken).push({ docId: doc.id, ref, targetType, targetId });
                }
              } catch {
                // Skip documents that can't be read
              }
            }

            return JSON.stringify({
              success: true,
              valid,
              broken,
              summary: `${valid.length} valid link(s), ${broken.length} broken link(s) across ${documents.length} document(s)`,
            }, null, 2);
          }

          case 'get_design_item': {
            const { project, session, id = 'design', item_number } = args as { project: string; session: string; id?: string; item_number: number };
            if (!project || !session || !item_number) throw new Error('Missing required: project, session, item_number');
            return await getDesignItem(project, session, id, item_number);
          }

          case 'patch_design_item': {
            const { project, session, id = 'design', item_number, old_string, new_string } = args as { project: string; session: string; id?: string; item_number: number; old_string: string; new_string: string };
            if (!project || !session || !item_number || !old_string || new_string === undefined) throw new Error('Missing required: project, session, item_number, old_string, new_string');
            return await patchDesignItem(project, session, id, item_number, old_string, new_string);
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

          case 'create_design': {
            const { project, session, name, content: rawContent } = args as { project: string; session: string; name: string; content: any };
            if (!project || !session || !name || !rawContent) throw new Error('Missing required: project, session, name, content');
            // Convert tree spec ({ type, children }) to scene graph ({ rootId, nodes[] })
            let content = rawContent
            if (isTreeSpec(rawContent)) {
              content = treeToGraph(rawContent)
            } else if (rawContent && rawContent.rootId && Array.isArray(rawContent.nodes)) {
              // Validate and auto-fix existing graph structure
              validateAndFixGraph(rawContent);
            }
            const result = await handleCreateDesign(project, session, name, content);
            return JSON.stringify(result, null, 2);
          }

          case 'update_design': {
            const { project, session, id, content: rawContent } = args as { project: string; session: string; id: string; content: any };
            if (!project || !session || !id || !rawContent) throw new Error('Missing required: project, session, id, content');
            // Convert tree spec ({ type, children }) to scene graph ({ rootId, nodes[] })
            let content = rawContent
            if (isTreeSpec(rawContent)) {
              content = treeToGraph(rawContent)
            } else if (rawContent && rawContent.rootId && Array.isArray(rawContent.nodes)) {
              validateAndFixGraph(rawContent);
            }
            const result = await handleUpdateDesign(project, session, id, content);
            return JSON.stringify(result, null, 2);
          }

          case 'get_design': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleGetDesign(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'list_designs': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await handleListDesigns(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'delete_design': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleDeleteDesign(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'get_design_history': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const response = await fetch(buildUrl(`/api/design/${id}/history`, project, session));
            if (!response.ok) {
              if (response.status === 404) {
                return JSON.stringify({ error: 'No history for design', history: null }, null, 2);
              }
              throw new Error(`Failed to get design history: ${response.statusText}`);
            }
            const data = await response.json();
            return JSON.stringify(data, null, 2);
          }

          case 'revert_design': {
            const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
            if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
            const versionResponse = await fetch(buildUrl(`/api/design/${id}/version`, project, session, { timestamp }));
            if (!versionResponse.ok) {
              throw new Error(`Failed to get design version: ${versionResponse.statusText}`);
            }
            const versionData = await versionResponse.json();
            const updateResponse = await fetch(buildUrl(`/api/design/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: versionData.content }),
            });
            if (!updateResponse.ok) {
              const error = await updateResponse.json();
              throw new Error(`Failed to revert design: ${error.error || updateResponse.statusText}`);
            }
            return JSON.stringify({
              success: true,
              id,
              revertedTo: timestamp,
              message: `Design reverted to version from ${timestamp}`,
            }, null, 2);
          }

          case 'add_design_node': {
            const { project, session, designId, ...nodeArgs } = args as { project: string; session: string; designId: string; [key: string]: any };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleAddDesignNode(project, session, designId, nodeArgs);
            return JSON.stringify(result, null, 2);
          }

          case 'update_design_node': {
            const { project, session, designId, nodeId, properties } = args as { project: string; session: string; designId: string; nodeId: string; properties: Record<string, any> };
            if (!project || !session || !designId || !nodeId || !properties) throw new Error('Missing required: project, session, designId, nodeId, properties');
            const result = await handleUpdateDesignNode(project, session, designId, nodeId, properties);
            return JSON.stringify(result, null, 2);
          }

          case 'remove_design_node': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleRemoveDesignNode(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'batch_design_operations': {
            const { project, session, designId, operations } = args as { project: string; session: string; designId: string; operations: any[] };
            if (!project || !session || !designId || !operations) throw new Error('Missing required: project, session, designId, operations');
            const result = await handleBatchDesignOperations(project, session, designId, operations);
            return JSON.stringify(result, null, 2);
          }

          case 'get_design_node': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleGetDesignNode(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'list_design_nodes': {
            const { project, session, designId, parentId, depth } = args as { project: string; session: string; designId: string; parentId?: string; depth?: number };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleListDesignNodes(project, session, designId, parentId, depth);
            return JSON.stringify(result, null, 2);
          }

          case 'group_design_nodes': {
            const { project, session, designId, nodeIds, name } = args as { project: string; session: string; designId: string; nodeIds: string[]; name?: string };
            if (!project || !session || !designId || !nodeIds) throw new Error('Missing required: project, session, designId, nodeIds');
            const result = await handleGroupDesignNodes(project, session, designId, nodeIds, name);
            return JSON.stringify(result, null, 2);
          }

          case 'ungroup_design_nodes': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleUngroupDesignNodes(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'reorder_design_nodes': {
            const { project, session, designId, nodeIds, direction } = args as { project: string; session: string; designId: string; nodeIds: string[]; direction: 'front' | 'back' | 'forward' | 'backward' };
            if (!project || !session || !designId || !nodeIds || !direction) throw new Error('Missing required: project, session, designId, nodeIds, direction');
            const result = await handleReorderDesignNodes(project, session, designId, nodeIds, direction);
            return JSON.stringify(result, null, 2);
          }

          case 'duplicate_design_nodes': {
            const { project, session, designId, nodeIds, offsetX, offsetY } = args as { project: string; session: string; designId: string; nodeIds: string[]; offsetX?: number; offsetY?: number };
            if (!project || !session || !designId || !nodeIds) throw new Error('Missing required: project, session, designId, nodeIds');
            const result = await handleDuplicateDesignNodes(project, session, designId, nodeIds, offsetX, offsetY);
            return JSON.stringify(result, null, 2);
          }

          case 'align_design_nodes': {
            const { project, session, designId, nodeIds, action } = args as { project: string; session: string; designId: string; nodeIds: string[]; action: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distributeH' | 'distributeV' };
            if (!project || !session || !designId || !nodeIds || !action) throw new Error('Missing required: project, session, designId, nodeIds, action');
            const result = await handleAlignDesignNodes(project, session, designId, nodeIds, action);
            return JSON.stringify(result, null, 2);
          }

          case 'transform_design_nodes': {
            const { project, session, designId, nodeIds, action } = args as { project: string; session: string; designId: string; nodeIds: string[]; action: 'flipH' | 'flipV' };
            if (!project || !session || !designId || !nodeIds || !action) throw new Error('Missing required: project, session, designId, nodeIds, action');
            const result = await handleTransformDesignNodes(project, session, designId, nodeIds, action);
            return JSON.stringify(result, null, 2);
          }

          case 'create_design_from_tree': {
            const { project, session, designId, tree, parentId } = args as { project: string; session: string; designId: string; tree: Record<string, any>; parentId?: string };
            if (!project || !session || !designId || !tree) throw new Error('Missing required: project, session, designId, tree');
            const result = await handleCreateDesignFromTree(project, session, designId, tree, parentId);
            return JSON.stringify(result, null, 2);
          }

          case 'add_design_image': {
            const { project, session, designId, ...imageArgs } = args as { project: string; session: string; designId: string; [key: string]: any };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleAddDesignImage(project, session, designId, imageArgs);
            return JSON.stringify(result, null, 2);
          }

          case 'set_node_image': {
            const { project, session, designId, nodeId, source, sourceType, imageScaleMode } = args as { project: string; session: string; designId: string; nodeId: string; source: string; sourceType?: string; imageScaleMode?: string };
            if (!project || !session || !designId || !nodeId || !source) throw new Error('Missing required: project, session, designId, nodeId, source');
            const result = await handleSetNodeImage(project, session, designId, nodeId, source, sourceType, imageScaleMode);
            return JSON.stringify(result, null, 2);
          }

          case 'export_design_svg': {
            const { project, session, designId, nodeId, outputPath } = args as { project: string; session: string; designId: string; nodeId?: string; outputPath?: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleExportDesignSvg(project, session, designId, nodeId, outputPath);
            return JSON.stringify(result, null, 2);
          }

          case 'export_design_code': {
            const { project, session, designId, nodeId, framework, outputPath } = args as { project: string; session: string; designId: string; nodeId?: string; framework?: 'react' | 'html'; outputPath?: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleExportDesignCode(project, session, designId, nodeId, framework, undefined, outputPath);
            return JSON.stringify(result, null, 2);
          }

          case 'create_from_template': {
            const { project, session, designId, template, params, parentId } = args as { project: string; session: string; designId: string; template: string; params?: Record<string, any>; parentId?: string };
            if (!project || !session || !designId || !template) throw new Error('Missing required: project, session, designId, template');
            const result = await handleCreateFromTemplate(project, session, designId, template, params, parentId);
            return JSON.stringify(result, null, 2);
          }

          case 'create_design_tokens': {
            const { project, session, designId, preset, custom } = args as { project: string; session: string; designId: string; preset?: string; custom?: any };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            if (!preset && !custom) throw new Error('Either preset or custom is required');
            const result = await handleCreateDesignTokens(project, session, designId, preset, custom);
            return JSON.stringify(result, null, 2);
          }

          case 'apply_design_tokens': {
            const { project, session, designId, nodeId, bindings } = args as { project: string; session: string; designId: string; nodeId: string; bindings: Record<string, string> };
            if (!project || !session || !designId || !nodeId || !bindings) throw new Error('Missing required: project, session, designId, nodeId, bindings');
            const result = await handleApplyDesignTokens(project, session, designId, nodeId, bindings);
            return JSON.stringify(result, null, 2);
          }

          // Design Annotations
          case 'annotate_node': {
            const { project, session, designId, nodeId, intent, notes, status } = args as { project: string; session: string; designId: string; nodeId: string; intent?: string; notes?: string; status?: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleAnnotateNode(project, session, designId, nodeId, { intent, notes, status });
            return JSON.stringify(result, null, 2);
          }

          case 'get_annotations': {
            const { project, session, designId, status } = args as { project: string; session: string; designId: string; status?: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleGetAnnotations(project, session, designId, status);
            return JSON.stringify(result, null, 2);
          }

          case 'remove_annotation': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleRemoveAnnotation(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          // Visual Feedback
          case 'describe_design': {
            const { project, session, designId, mode } = args as { project: string; session: string; designId: string; mode?: 'full' | 'summary' };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleDescribeDesign(project, session, designId, mode);
            return JSON.stringify(result, null, 2);
          }

          // Design Linting
          case 'lint_design': {
            const { project, session, designId } = args as { project: string; session: string; designId: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleLintDesign(project, session, designId);
            return JSON.stringify(result, null, 2);
          }

          // Design Diff
          case 'describe_design_changes': {
            const { project, session, designId, since } = args as { project: string; session: string; designId: string; since?: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            // Fetch current design
            const currentDesign = await handleGetDesign(project, session, designId);
            const currentContent = typeof currentDesign.content === 'string' ? JSON.parse(currentDesign.content) : currentDesign.content;
            // Fetch history
            const historyUrl = since
              ? buildUrl(`/api/design/${designId}/version`, project, session, { timestamp: since })
              : buildUrl(`/api/design/${designId}/history`, project, session);
            const historyResponse = await fetch(historyUrl);
            if (!historyResponse.ok) {
              if (historyResponse.status === 404) {
                return JSON.stringify({ success: true, diff: { added: [], removed: [], modified: [], summary: 'No history available' } }, null, 2);
              }
              throw new Error(`Failed to get design history: ${historyResponse.statusText}`);
            }
            const historyData = await historyResponse.json();
            // Get the previous graph
            let previousContent: any;
            if (since) {
              // /version endpoint returns { content }
              previousContent = historyData.content;
            } else {
              // /history endpoint returns { original, updates }
              previousContent = historyData.original;
            }
            if (!previousContent) {
              return JSON.stringify({ success: true, diff: { added: [], removed: [], modified: [], summary: 'No previous version found' } }, null, 2);
            }
            const previousParsed = typeof previousContent === 'string' ? JSON.parse(previousContent) : previousContent;
            const currentGraph = getGraph(currentContent);
            const previousGraph = getGraph(previousParsed);
            const diff = computeDesignDiff(currentGraph, previousGraph);
            return JSON.stringify({ success: true, diff }, null, 2);
          }

          // Component Library
          case 'create_component': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleCreateComponent(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'create_instance': {
            const { project, session, designId, componentId, parentId, x, y } = args as { project: string; session: string; designId: string; componentId: string; parentId?: string; x?: number; y?: number };
            if (!project || !session || !designId || !componentId) throw new Error('Missing required: project, session, designId, componentId');
            const result = await handleCreateInstance(project, session, designId, componentId, parentId, x, y);
            return JSON.stringify(result, null, 2);
          }

          case 'list_components': {
            const { project, session, designId } = args as { project: string; session: string; designId: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleListComponents(project, session, designId);
            return JSON.stringify(result, null, 2);
          }

          case 'detach_instance': {
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleDetachInstance(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'save_component': {
            const { project, session, designId, nodeId, componentName } = args as { project: string; session: string; designId: string; nodeId: string; componentName?: string };
            if (!project || !session || !designId || !nodeId) throw new Error('Missing required: project, session, designId, nodeId');
            const result = await handleSaveComponent(project, session, designId, nodeId, componentName);
            return JSON.stringify(result, null, 2);
          }

          case 'load_component': {
            const { project, session, designId, componentName, parentId, x, y } = args as { project: string; session: string; designId: string; componentName: string; parentId?: string; x?: number; y?: number };
            if (!project || !session || !designId || !componentName) throw new Error('Missing required: project, session, designId, componentName');
            const result = await handleLoadComponent(project, session, designId, componentName, parentId, x, y);
            return JSON.stringify(result, null, 2);
          }

          case 'list_library_components': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await handleListLibraryComponents(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'export_design_png': {
            const { project, session, id, format, scale, outputPath } = args as { project: string; session: string; id: string; format?: string; scale?: number; outputPath?: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleExportDesign(project, session, id, format || 'png', scale || 2, outputPath);
            return JSON.stringify(result, null, 2);
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
              currentItem?: number | null;
              currentItemType?: 'code' | 'task' | 'bugfix';
              workItems?: Array<{
                number: number;
                title: string;
                type: 'code' | 'task' | 'bugfix';
                status: 'pending' | 'documented';
              }> | string;
              completedTasks?: string[];
              pendingTasks?: string[];
              totalItems?: number;
              documentedItems?: number;
              useRenderUI?: boolean;
              sessionType?: 'structured' | 'vibe';
            };
            if (!project || !session) throw new Error('Missing required: project, session');

            // Handle case where workItems might be a JSON string instead of an array
            // This can happen when the MCP client sends large or complex arrays
            if (updates.workItems && typeof updates.workItems === 'string') {
              try {
                updates.workItems = JSON.parse(updates.workItems);
              } catch (error) {
                throw new Error(`Failed to parse workItems: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
              }
            }

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

          case 'kodex_direct_update_topic': {
            const { project, name: topicName, content, reason } = args as {
              project: string;
              name: string;
              content: Partial<TopicContent>;
              reason: string;
            };
            if (!project || !topicName || !content || !reason) throw new Error('Missing required: project, name, content, reason');
            const kodex = getKodexManager(project);
            const result = await kodex.directUpdateTopic(topicName, content, reason);
            return JSON.stringify({ ...result, message: 'Topic updated directly. Flagged as needs-review.' }, null, 2);
          }

          case 'kodex_direct_create_topic': {
            const { project, name: topicName, title, content, reason } = args as {
              project: string;
              name: string;
              title: string;
              content: TopicContent;
              reason: string;
            };
            if (!project || !topicName || !title || !content || !reason) throw new Error('Missing required: project, name, title, content, reason');
            const kodex = getKodexManager(project);
            const result = await kodex.directCreateTopic(topicName, title, content, reason);
            return JSON.stringify({ ...result, message: 'Topic created directly with confidence=medium. Flagged as needs-review.' }, null, 2);
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

          case 'add_lesson': {
            const { project, session, lesson, category } = args as {
              project: string;
              session: string;
              lesson: string;
              category?: 'universal' | 'codebase' | 'workflow' | 'gotcha';
            };
            if (!project || !session || !lesson) throw new Error('Missing required: project, session, lesson');
            const result = await addLesson(project, session, lesson, category);
            return JSON.stringify(result, null, 2);
          }

          case 'list_lessons': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await listLessons(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'list_todos': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const result = await listTodos(project);
            return JSON.stringify(result, null, 2);
          }

          case 'add_todo': {
            const { project, title, description } = args as { project: string; title: string; description?: string };
            if (!project || !title) throw new Error('Missing required: project, title');
            const result = await addTodo(project, title);
            // Register the session
            await sessionRegistry.register(project, result.todo.sessionName, 'vibe', true, 'vibe-active');
            // If description provided, create it as a document in the todo's session
            if (description) {
              await createDocument(project, result.todo.sessionName, 'description', description);
            }
            return JSON.stringify(result, null, 2);
          }

          case 'remove_todo': {
            const { project, id } = args as { project: string; id: number };
            if (!project || id === undefined) throw new Error('Missing required: project, id');
            const result = await removeTodo(project, id);
            return JSON.stringify(result, null, 2);
          }

          case 'update_todo': {
            const { project, id, title } = args as { project: string; id: number; title?: string };
            if (!project || id === undefined) throw new Error('Missing required: project, id');
            const result = await updateTodo(project, id, { title });
            return JSON.stringify(result, null, 2);
          }

          case 'list_todo_items': {
            const { project, id } = args as { project: string; id: number };
            if (!project || id === undefined) throw new Error('Missing required: project, id');
            const todosResult = await listTodos(project);
            const todo = todosResult.todos.find(t => t.id === id);
            if (!todo) throw new Error(`Todo with id ${id} not found`);
            const session = todo.sessionName;
            const [diagrams, documents, designs, spreadsheets] = await Promise.all([
              listDiagrams(project, session).catch(() => '[]'),
              listDocuments(project, session).catch(() => '[]'),
              handleListDesigns(project, session).catch(() => ({ designs: [], count: 0 })),
              listSpreadsheets(project, session).catch(() => '{"spreadsheets":[]}'),
            ]);
            return JSON.stringify({
              todo,
              session,
              diagrams: JSON.parse(diagrams),
              documents: JSON.parse(documents),
              designs,
              spreadsheets: JSON.parse(spreadsheets),
            }, null, 2);
          }

          // Spreadsheet tools
          case 'list_spreadsheets': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            return await listSpreadsheets(project, session);
          }

          case 'get_spreadsheet': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            return await getSpreadsheet(project, session, id);
          }

          case 'create_spreadsheet': {
            const { project, session, name: sName, columns, rows } = args as {
              project: string; session: string; name: string;
              columns: Array<{ name: string; type: string; width?: number }>;
              rows?: Array<Record<string, any>>;
            };
            if (!project || !session || !sName || !columns) throw new Error('Missing required: project, session, name, columns');

            // Build SpreadsheetData JSON
            const colDefs = columns.map(col => ({
              id: `col_${col.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
              name: col.name,
              type: col.type,
              ...(col.width ? { width: col.width } : {}),
            }));

            // Build name→id map
            const nameToId: Record<string, string> = {};
            for (const col of colDefs) {
              nameToId[col.name] = col.id;
            }

            const rowDefs = (rows || []).map((row, i) => {
              const cells: Record<string, any> = {};
              for (const [key, value] of Object.entries(row)) {
                const colId = nameToId[key];
                if (colId) {
                  cells[colId] = value;
                }
              }
              return { id: `row_${i + 1}`, cells };
            });

            const spreadsheetData = JSON.stringify({ columns: colDefs, rows: rowDefs }, null, 2);

            // Register session and project if not already registered
            await sessionRegistry.register(project, session);
            await projectRegistry.register(project);

            return await createSpreadsheet(project, session, sName, spreadsheetData);
          }

          case 'update_spreadsheet': {
            const { project, session, id, content } = args as { project: string; session: string; id: string; content: string };
            if (!project || !session || !id || !content) throw new Error('Missing required: project, session, id, content');
            return await updateSpreadsheet(project, session, id, content);
          }

          case 'delete_spreadsheet': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const response = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
              method: 'DELETE',
            });
            if (!response.ok) {
              const error = await response.json() as { error?: string };
              throw new Error(`Failed to delete spreadsheet: ${error.error || response.statusText}`);
            }
            return JSON.stringify({ success: true, id, message: 'Spreadsheet deleted' }, null, 2);
          }

          case 'get_spreadsheet_history': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const response = await fetch(buildUrl(`/api/spreadsheet/${id}/history`, project, session));
            if (!response.ok) {
              if (response.status === 404) {
                return JSON.stringify({ error: 'No history for spreadsheet', history: null }, null, 2);
              }
              throw new Error(`Failed to get spreadsheet history: ${response.statusText}`);
            }
            const data = await response.json();
            return JSON.stringify(data, null, 2);
          }

          case 'revert_spreadsheet': {
            const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
            if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
            const versionResponse = await fetch(buildUrl(`/api/spreadsheet/${id}/version`, project, session, { timestamp }));
            if (!versionResponse.ok) {
              throw new Error(`Failed to get spreadsheet version: ${versionResponse.statusText}`);
            }
            const versionData = await versionResponse.json() as { content: string };
            const updateResponse = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: versionData.content }),
            });
            if (!updateResponse.ok) {
              const error = await updateResponse.json() as { error?: string };
              throw new Error(`Failed to revert spreadsheet: ${error.error || updateResponse.statusText}`);
            }
            return JSON.stringify({
              success: true,
              id,
              revertedTo: timestamp,
              message: `Spreadsheet reverted to version from ${timestamp}`,
            }, null, 2);
          }

          case 'patch_spreadsheet': {
            const { project, session, id, operations } = args as {
              project: string; session: string; id: string;
              operations: Array<{
                op: string;
                rowId?: string;
                cells?: Record<string, any>;
                columnId?: string;
                name?: string;
                type?: string;
                defaultValue?: any;
                function?: string;
              }>;
            };
            if (!project || !session || !id || !operations) throw new Error('Missing required: project, session, id, operations');

            // Get current spreadsheet
            const getResp = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
            if (!getResp.ok) {
              throw new Error(`Spreadsheet not found: ${id}`);
            }
            const ssData = await getResp.json();
            const data = JSON.parse(ssData.content) as {
              columns: Array<{ id: string; name: string; type: string; width?: number }>;
              rows: Array<{ id: string; cells: Record<string, any> }>;
              aggregates?: Record<string, string>;
            };

            // Build name→id map
            const colNameToId: Record<string, string> = {};
            for (const col of data.columns) {
              colNameToId[col.name] = col.id;
            }

            // Apply operations
            for (const op of operations) {
              switch (op.op) {
                case 'add_row': {
                  const cells: Record<string, any> = {};
                  if (op.cells) {
                    for (const [key, value] of Object.entries(op.cells)) {
                      const colId = colNameToId[key] || key;
                      cells[colId] = value;
                    }
                  }
                  data.rows.push({ id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, cells });
                  break;
                }
                case 'update_row': {
                  const row = data.rows.find(r => r.id === op.rowId);
                  if (!row) throw new Error(`Row not found: ${op.rowId}`);
                  if (op.cells) {
                    for (const [key, value] of Object.entries(op.cells)) {
                      const colId = colNameToId[key] || key;
                      row.cells[colId] = value;
                    }
                  }
                  break;
                }
                case 'delete_row': {
                  const idx = data.rows.findIndex(r => r.id === op.rowId);
                  if (idx === -1) throw new Error(`Row not found: ${op.rowId}`);
                  data.rows.splice(idx, 1);
                  break;
                }
                case 'add_column': {
                  if (!op.name || !op.type) throw new Error('add_column requires name and type');
                  const newColId = `col_${op.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
                  data.columns.push({ id: newColId, name: op.name, type: op.type });
                  colNameToId[op.name] = newColId;
                  // Set default value for existing rows
                  if (op.defaultValue !== undefined) {
                    for (const row of data.rows) {
                      row.cells[newColId] = op.defaultValue;
                    }
                  }
                  break;
                }
                case 'delete_column': {
                  if (!op.columnId) throw new Error('delete_column requires columnId');
                  data.columns = data.columns.filter(c => c.id !== op.columnId);
                  for (const row of data.rows) {
                    delete row.cells[op.columnId];
                  }
                  if (data.aggregates) {
                    delete data.aggregates[op.columnId];
                  }
                  break;
                }
                case 'rename_column': {
                  if (!op.columnId || !op.name) throw new Error('rename_column requires columnId and name');
                  const col = data.columns.find(c => c.id === op.columnId);
                  if (!col) throw new Error(`Column not found: ${op.columnId}`);
                  delete colNameToId[col.name];
                  col.name = op.name;
                  colNameToId[op.name] = col.id;
                  break;
                }
                case 'set_aggregate': {
                  if (!op.columnId || !op.function) throw new Error('set_aggregate requires columnId and function');
                  if (!data.aggregates) data.aggregates = {};
                  data.aggregates[op.columnId] = op.function;
                  break;
                }
                default:
                  throw new Error(`Unknown operation: ${op.op}`);
              }
            }

            const newContent = JSON.stringify(data, null, 2);
            return await updateSpreadsheet(project, session, id, newContent);
          }

          case 'export_spreadsheet_csv': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');

            const getResp = await fetch(buildUrl(`/api/spreadsheet/${id}`, project, session));
            if (!getResp.ok) {
              throw new Error(`Spreadsheet not found: ${id}`);
            }
            const ssData = await getResp.json();
            const data = JSON.parse(ssData.content) as {
              columns: Array<{ id: string; name: string; type: string }>;
              rows: Array<{ id: string; cells: Record<string, any> }>;
            };

            // Build CSV
            const escapeCsv = (val: any): string => {
              if (val === null || val === undefined) return '';
              const str = String(val);
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            };

            const header = data.columns.map(c => escapeCsv(c.name)).join(',');
            const rows = data.rows.map(row =>
              data.columns.map(col => escapeCsv(row.cells[col.id])).join(',')
            );

            const csv = [header, ...rows].join('\n');
            return JSON.stringify({ success: true, id, csv }, null, 2);
          }

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
            const { project, session, name, content, sourcePath, startLine, endLine, groupId, groupName } = args as {
              project: string; session: string; name?: string; content?: string;
              sourcePath?: string; startLine?: number; endLine?: number; groupId?: string; groupName?: string;
            };
            if (!project || !session) throw new Error('Missing required: project, session');
            if (!sourcePath && (!name || content === undefined)) throw new Error('Either provide name+content, or sourcePath');
            const result = await handleCreateSnippet(project, session, name, content, sourcePath, startLine, endLine, groupId, groupName);
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
            const { project, session, id, format, outputPath } = args as { project: string; session: string; id: string; format?: string; outputPath?: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleExportSnippet(project, session, id, format, outputPath);
            return JSON.stringify(result, null, 2);
          }

          case 'apply_snippet': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const result = await handleApplySnippet(project, session, id);
            return JSON.stringify(result, null, 2);
          }

          case 'snippet_history': {
            const { project, session, id } = args as { project: string; session: string; id: string };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const url = new URL(`/api/snippet/${encodeURIComponent(id)}/history`, API_BASE_URL);
            url.searchParams.set('project', project);
            url.searchParams.set('session', session);
            const resp = await fetch(url.toString());
            if (!resp.ok) throw new Error(`Failed to get snippet history: ${resp.statusText}`);
            return JSON.stringify(await resp.json(), null, 2);
          }

          case 'patch_snippet': {
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
            const resp = await fetch(url.toString());
            if (!resp.ok) throw new Error(`Failed to get snippet version: ${resp.statusText}`);
            const { content } = await resp.json() as { content: string; timestamp: number };
            // Revert by saving the historical content
            const saveUrl = new URL(`/api/snippet/${encodeURIComponent(id)}`, API_BASE_URL);
            saveUrl.searchParams.set('project', project);
            saveUrl.searchParams.set('session', session);
            const saveResp = await fetch(saveUrl.toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content }),
            });
            if (!saveResp.ok) throw new Error(`Failed to revert snippet: ${saveResp.statusText}`);
            return JSON.stringify({ success: true, revertedTo: timestamp }, null, 2);
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
