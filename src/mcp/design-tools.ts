// Design MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the cohesive DESIGN tool group: the design/design-ai/design-templates tool
// imports, the ListTools declarations (DESIGN_TOOL_DEFS), the CallTool handlers
// (handleDesignTool), and the design-item helper functions (extractDesignItem/
// getDesignItem/patchDesignItem) which were local to setup.ts and used only here.
// Assembled from exact byte ranges of setup.ts — behavior is identical, a pure move.
import { API_BASE_URL, buildUrl, asJson, sessionParamsDesc } from './tools/http-util.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
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
} from './tools/design-ai.js';
import {
  createFromTemplateSchema,
  createDesignTokensSchema,
  applyDesignTokensSchema,
  handleCreateFromTemplate,
  handleCreateDesignTokens,
  handleApplyDesignTokens,
} from './tools/design-templates.js';

// ---- design-item helpers (were local in setup.ts; used only by this group) ----
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
  const data = await asJson(response);
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
  const docData = await asJson(getResponse);
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
    const error = await asJson(updateResponse);
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

export const DESIGN_TOOL_DEFS = [
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
        description: 'Export a design or node subtree as SVG. Renders fills, strokes, text, images, corners, opacity, rotation, and clipping server-side. Returns SVG string.',
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
];

export async function handleDesignTool(name: string, args: any): Promise<string | null> {
  switch (name) {
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
            const data = await asJson(response);
            return JSON.stringify(data, null, 2);
          }

          case 'revert_design': {
            const { project, session, id, timestamp } = args as { project: string; session: string; id: string; timestamp: string };
            if (!project || !session || !id || !timestamp) throw new Error('Missing required: project, session, id, timestamp');
            const versionResponse = await fetch(buildUrl(`/api/design/${id}/version`, project, session, { timestamp }));
            if (!versionResponse.ok) {
              throw new Error(`Failed to get design version: ${versionResponse.statusText}`);
            }
            const versionData = await asJson(versionResponse);
            const updateResponse = await fetch(buildUrl(`/api/design/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: versionData.content }),
            });
            if (!updateResponse.ok) {
              const error = await asJson(updateResponse);
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
            const { project, session, designId, nodeId } = args as { project: string; session: string; designId: string; nodeId?: string };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleExportDesignSvg(project, session, designId, nodeId);
            return JSON.stringify(result, null, 2);
          }

          case 'export_design_code': {
            const { project, session, designId, nodeId, framework } = args as { project: string; session: string; designId: string; nodeId?: string; framework?: 'react' | 'html' };
            if (!project || !session || !designId) throw new Error('Missing required: project, session, designId');
            const result = await handleExportDesignCode(project, session, designId, nodeId, framework);
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
            const historyData = await asJson(historyResponse);
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
    default:
      return null;
  }
}
