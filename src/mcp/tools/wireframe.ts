/**
 * MCP Tools: Wireframe Management
 *
 * Provides tools for creating, updating, listing, and previewing wireframes.
 * Tools:
 * - create_wireframe: Create a new wireframe
 * - update_wireframe: Update an existing wireframe
 * - get_wireframe: Retrieve a wireframe by ID
 * - list_wireframes: List all wireframes in a session
 * - preview_wireframe: Get preview URL for a wireframe
 * - export_wireframe_svg: Export wireframe as SVG
 * - export_wireframe_png: Export wireframe as PNG (base64)
 */

import { Resvg } from '@resvg/resvg-js';

// Configuration
const API_PORT = parseInt(process.env.PORT || '3737', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * Build URL with project and session parameters
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
 * Type definitions for wireframe content (placeholder for JSON structure)
 */
export interface WireframeRoot {
  [key: string]: any;
}

export interface CreateWireframeResult {
  success: boolean;
  id: string;
  previewUrl: string;
}

export interface UpdateWireframeResult {
  success: boolean;
  id: string;
}

export interface GetWireframeResult {
  id: string;
  name: string;
  content: WireframeRoot;
  lastModified: number;
}

export interface ListWireframesResult {
  wireframes: Array<{
    id: string;
    name: string;
    lastModified: number;
  }>;
}

export interface PreviewWireframeResult {
  id: string;
  previewUrl: string;
}

/**
 * Tool: create_wireframe
 *
 * Create a new wireframe with JSON content
 */
export const createWireframeSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    name: {
      type: 'string',
      description: 'Wireframe name',
    },
    content: {
      type: 'object',
      description: 'Wireframe JSON content',
    },
  },
  required: ['project', 'name', 'content'],
};

export async function handleCreateWireframe(
  project: string,
  session: string,
  name: string,
  content: WireframeRoot
): Promise<CreateWireframeResult> {
  if (!project || !session || !name || !content) {
    throw new Error('Missing required: project, session, name, content');
  }

  const response = await fetch(buildUrl('/api/wireframe', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    throw new Error('Failed to create wireframe');
  }

  const data = await response.json();
  const previewUrl = `${API_BASE_URL}/wireframe.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${data.id}`;

  return {
    success: true,
    id: data.id,
    previewUrl,
  };
}

/**
 * Tool: update_wireframe
 *
 * Update an existing wireframe's content
 */
export const updateWireframeSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    id: {
      type: 'string',
      description: 'Wireframe ID',
    },
    content: {
      type: 'object',
      description: 'Updated wireframe JSON content',
    },
  },
  required: ['project', 'id', 'content'],
};

export async function handleUpdateWireframe(
  project: string,
  session: string,
  id: string,
  content: WireframeRoot
): Promise<UpdateWireframeResult> {
  if (!project || !session || !id || !content) {
    throw new Error('Missing required: project, session, id, content');
  }

  const response = await fetch(buildUrl(`/api/wireframe/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error('Failed to update wireframe');
  }

  return {
    success: true,
    id,
  };
}

/**
 * Tool: get_wireframe
 *
 * Retrieve a wireframe by ID
 */
export const getWireframeSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    id: {
      type: 'string',
      description: 'Wireframe ID',
    },
  },
  required: ['project', 'id'],
};

export async function handleGetWireframe(
  project: string,
  session: string,
  id: string
): Promise<GetWireframeResult> {
  if (!project || !session || !id) {
    throw new Error('Missing required: project, session, id');
  }

  const response = await fetch(buildUrl(`/api/wireframe/${id}`, project, session));

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Wireframe not found');
    }
    throw new Error('Failed to get wireframe');
  }

  const data = await response.json();
  return data;
}

/**
 * Tool: list_wireframes
 *
 * List all wireframes in a session
 */
export const listWireframesSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
  },
  required: ['project'],
};

export async function handleListWireframes(
  project: string,
  session: string
): Promise<ListWireframesResult> {
  if (!project || !session) {
    throw new Error('Missing required: project, session');
  }

  const response = await fetch(buildUrl('/api/wireframes', project, session));

  if (!response.ok) {
    throw new Error('Failed to list wireframes');
  }

  const data = await response.json();
  return data;
}

/**
 * Tool: preview_wireframe
 *
 * Get the browser preview URL for a wireframe
 */
export const previewWireframeSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    id: {
      type: 'string',
      description: 'Wireframe ID',
    },
  },
  required: ['project', 'id'],
};

export async function handlePreviewWireframe(
  project: string,
  session: string,
  id: string
): Promise<PreviewWireframeResult> {
  if (!project || !session || !id) {
    throw new Error('Missing required: project, session, id');
  }

  const response = await fetch(buildUrl(`/api/wireframe/${id}`, project, session));

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Wireframe not found');
    }
    throw new Error('Failed to get wireframe');
  }

  const previewUrl = `${API_BASE_URL}/wireframe.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${id}`;

  return {
    id,
    previewUrl,
  };
}

/**
 * Result type for export wireframe SVG
 */
export interface ExportWireframeSVGResult {
  id: string;
  svg: string;
  width: number;
  height: number;
}

/**
 * Tool: export_wireframe_svg
 *
 * Export a wireframe as an SVG string that can be viewed as an image.
 * This renders the wireframe to a complete SVG document.
 */
export const exportWireframeSVGSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    id: {
      type: 'string',
      description: 'Wireframe ID',
    },
    scale: {
      type: 'number',
      description: 'Scale factor for the SVG (default: 1)',
    },
  },
  required: ['project', 'id'],
};

export async function handleExportWireframeSVG(
  project: string,
  session: string,
  id: string,
  scale?: number
): Promise<ExportWireframeSVGResult> {
  if (!project || !session || !id) {
    throw new Error('Missing required: project, session, id');
  }

  const scaleParam = scale ? `&scale=${scale}` : '';
  const response = await fetch(
    buildUrl(`/api/wireframe/${id}/render`, project, session) + scaleParam
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Wireframe not found');
    }
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || 'Failed to export wireframe SVG');
  }

  const svg = await response.text();

  // Extract dimensions from SVG
  const widthMatch = svg.match(/width="(\d+)"/);
  const heightMatch = svg.match(/height="(\d+)"/);
  const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
  const height = heightMatch ? parseInt(heightMatch[1], 10) : 0;

  return {
    id,
    svg,
    width,
    height,
  };
}

/**
 * Result type for export wireframe PNG
 */
export interface ExportWireframePNGResult {
  id: string;
  png: string; // base64 encoded PNG
  width: number;
  height: number;
}

/**
 * Tool: export_wireframe_png
 *
 * Export a wireframe as a PNG image (base64 encoded).
 * This renders the wireframe to SVG, then converts to PNG using resvg.
 */
export const exportWireframePNGSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Absolute path to project root',
    },
    session: {
      type: 'string',
      description: 'Session name. Either session or todoId is required.',
    },
    todoId: {
      type: 'number',
      description: 'Todo ID. Alternative to session — resolves the session from the todo.',
    },
    id: {
      type: 'string',
      description: 'Wireframe ID',
    },
    scale: {
      type: 'number',
      description: 'Scale factor for the PNG (default: 1)',
    },
  },
  required: ['project', 'id'],
};

export async function handleExportWireframePNG(
  project: string,
  session: string,
  id: string,
  scale?: number
): Promise<ExportWireframePNGResult> {
  // First get the SVG
  const svgResult = await handleExportWireframeSVG(project, session, id, scale);

  // Convert SVG to PNG using resvg
  const resvg = new Resvg(svgResult.svg, {
    background: '#f8f9fa',
    fitTo: {
      mode: 'original',
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const png = pngBuffer.toString('base64');

  return {
    id,
    png,
    width: svgResult.width,
    height: svgResult.height,
  };
}
