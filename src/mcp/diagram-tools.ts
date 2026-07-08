// Diagram MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive DIAGRAM tool group: the ListTools declarations
// (DIAGRAM_TOOL_DEFS), the CallTool handlers (handleDiagramTool), and the diagram
// helper functions that were local to setup.ts. The list/get/create/update helpers
// are exported because setup.ts still calls them from other flows (session summary,
// clear-artifacts, design_to_diagram). Imports only leaf modules (http-util +
// design-ai / diagram-codegen tool modules), so there is no import cycle with
// setup.ts. Behavior is identical — a pure move.
import { API_BASE_URL, buildUrl, asJson, sessionParamsDesc } from './tools/http-util.js';
import { designToDiagramSchema, handleDesignToDiagram } from './tools/design-ai.js';
import { diagramFromCodeSchema, handleDiagramFromCode } from './tools/diagram-codegen.js';

// ---------------------------------------------------------------------------
// Diagram helpers (were inline in setup.ts; exported for setup.ts's other callers)
// ---------------------------------------------------------------------------

export async function listDiagrams(project: string, session: string): Promise<string> {
  const response = await fetch(buildUrl('/api/diagrams', project, session));
  if (!response.ok) {
    throw new Error(`Failed to list diagrams: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function getDiagram(project: string, session: string, id: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
}

export async function createDiagram(project: string, session: string, name: string, content: string): Promise<string> {
  const response = await fetch(buildUrl('/api/diagram', project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
    throw new Error(`Failed to create diagram: ${error.error || response.statusText}`);
  }
  const data = await asJson(response);
  const previewUrl = `${API_BASE_URL}/diagram.html?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Diagram created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

export async function updateDiagram(project: string, session: string, id: string, content: string): Promise<string> {
  const response = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const error = await asJson(response);
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
  const data = await asJson(response);
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
    const error = await asJson(response);
    throw new Error(`Failed to transpile diagram: ${error.error || response.statusText}`);
  }
  const data = await asJson(response);
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

async function exportDiagramPNG(project: string, session: string, id: string, _theme?: string, _scale?: number): Promise<string> {
  // PNG export was previously implemented in-process via @resvg/resvg-js,
  // but that dependency is no longer installed. The diagram SVG endpoint
  // remains available — callers wanting PNG should rasterize client-side
  // or use export_design_png for designs.
  void project; void session; void id;
  throw new Error(
    'export_diagram_png is not supported in this build (no server-side ' +
    'rasterizer). Use export_diagram_svg and rasterize externally, or ' +
    'use export_design_png for designs.'
  );
}

async function patchDiagram(project: string, session: string, id: string, oldString: string, newString: string): Promise<string> {
  const getResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session));
  if (!getResponse.ok) {
    if (getResponse.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${getResponse.statusText}`);
  }

  const diagram = await asJson(getResponse);
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
    const error = await asJson(updateResponse);
    throw new Error(`Failed to patch diagram: ${error.error || updateResponse.statusText}`);
  }

  return JSON.stringify({ success: true, id, message: 'Diagram patched successfully' }, null, 2);
}

// ---------------------------------------------------------------------------
// ListTools declarations — spread into setup.ts via `...DIAGRAM_TOOL_DEFS`.
// ---------------------------------------------------------------------------

export const DIAGRAM_TOOL_DEFS = [
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
];

/**
 * Handle a diagram-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is not
 * a diagram tool — in which case the caller falls through to its own switch.
 */
export async function handleDiagramTool(name: string, args: any): Promise<string | null> {
  switch (name) {
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
      const data = await asJson(response);
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
      const versionData = await asJson(versionResponse);
      // Save as current content
      const updateResponse = await fetch(buildUrl(`/api/diagram/${id}`, project, session), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: versionData.content }),
      });
      if (!updateResponse.ok) {
        const error = await asJson(updateResponse);
        throw new Error(`Failed to revert diagram: ${error.error || updateResponse.statusText}`);
      }
      return JSON.stringify({
        success: true,
        id,
        revertedTo: timestamp,
        message: `Diagram reverted to version from ${timestamp}`,
      }, null, 2);
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

    case 'patch_diagram': {
      const { project, session, id, old_string, new_string } = args as { project: string; session: string; id: string; old_string: string; new_string: string };
      if (!project || !session || !id || !old_string || new_string === undefined) throw new Error('Missing required: project, session, id, old_string, new_string');
      return await patchDiagram(project, session, id, old_string, new_string);
    }

    default:
      return null;
  }
}
