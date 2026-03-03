/**
 * MCP Design AI Tools
 *
 * Higher-level scene graph manipulation tools that let Claude create and
 * modify design elements without constructing raw SceneNode JSON.
 *
 * These tools load the design, manipulate the serialized scene graph
 * ({ rootId, nodes }), and save it back via the design API.
 */

import { handleGetDesign, handleUpdateDesign } from './design'
import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'

// ============= Types =============

interface Color {
  r: number
  g: number
  b: number
  a: number
}

interface Fill {
  type: string
  color: Color
  opacity: number
  visible: boolean
}

interface Stroke {
  color: Color
  weight: number
  opacity: number
  visible: boolean
  align: string
}

interface SerializedNode {
  id: string
  type: string
  name: string
  parentId: string | null
  childIds: string[]
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fills: Fill[]
  strokes: Stroke[]
  opacity: number
  cornerRadius: number
  visible: boolean
  text: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  textAlignHorizontal: string
  layoutMode: string
  itemSpacing: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  [key: string]: any
}

interface SerializedGraph {
  rootId: string
  nodes: SerializedNode[]
  images?: Array<{ key: string; value: string }>
  variableCollections?: Array<{ id: string; name: string; modes: Array<{ modeId: string; name: string }>; defaultModeId: string; variableIds: string[] }>
  variables?: Array<{ id: string; name: string; resolvedType: string; valuesByMode: Record<string, any>; collectionId: string }>
}

// ============= Constants =============

const UNSAFE_PROPS = new Set(['id', 'parentId', 'childIds', 'type', '__proto__', 'constructor', 'prototype'])

// ============= Helpers =============

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getGraph(content: any): SerializedGraph {
  if (content && typeof content === 'object' && content.rootId && Array.isArray(content.nodes)) {
    return content as SerializedGraph
  }
  throw new Error('Design content is not a valid scene graph. Expected { rootId, nodes[] }')
}

function getAbsolutePosition(graph: SerializedGraph, nodeId: string): { x: number; y: number } {
  let x = 0, y = 0
  let current = graph.nodes.find(n => n.id === nodeId)
  while (current) {
    x += current.x
    y += current.y
    if (!current.parentId) break
    current = graph.nodes.find(n => n.id === current!.parentId)
  }
  return { x, y }
}

function findCurrentPage(graph: SerializedGraph): SerializedNode | null {
  const root = graph.nodes.find(n => n.id === graph.rootId)
  if (!root || root.childIds.length === 0) return null
  return graph.nodes.find(n => n.id === root.childIds[0]) ?? null
}

/**
 * Validate and auto-fix a scene graph structure.
 * The design editor expects: CANVAS root → PAGE child(ren) → content.
 * If a PAGE is used as root, wraps it in a CANVAS node automatically.
 * Returns the (potentially fixed) graph.
 */
export function validateAndFixGraph(graph: SerializedGraph): SerializedGraph {
  const root = graph.nodes.find(n => n.id === graph.rootId)
  if (!root) throw new Error('Invalid design: rootId does not reference any node')

  // If root is already CANVAS, validate it has a PAGE child
  if (root.type === 'CANVAS') {
    if (root.childIds.length === 0) {
      throw new Error('Invalid design: CANVAS root must have at least one PAGE child')
    }
    const firstChild = graph.nodes.find(n => n.id === root.childIds[0])
    if (!firstChild) {
      throw new Error('Invalid design: CANVAS root references missing child node')
    }
    return graph
  }

  // If root is PAGE, auto-wrap in CANVAS
  if (root.type === 'PAGE') {
    const canvasId = generateId()
    const canvas: SerializedNode = {
      ...createDefaultNode('CANVAS', { name: 'Document' }),
      id: canvasId,
      parentId: null,
      childIds: [root.id],
    }
    root.parentId = canvasId
    graph.nodes.push(canvas)
    graph.rootId = canvasId
    return graph
  }

  // Any other type as root is invalid
  throw new Error(
    `Invalid design: root node must be type CANVAS (with PAGE children). Got type "${root.type}". ` +
    'Expected structure: { rootId → CANVAS node → PAGE child(ren) → content }'
  )
}

function createDefaultNode(type: string, overrides: Partial<SerializedNode> = {}): SerializedNode {
  return {
    id: generateId(),
    type,
    name: overrides.name ?? (type.charAt(0) + type.slice(1).toLowerCase()),
    parentId: null,
    childIds: [],
    x: 0, y: 0,
    width: 100, height: 100,
    rotation: 0,
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    independentCorners: false,
    cornerSmoothing: 0,
    visible: true,
    locked: false,
    clipsContent: false,
    text: '',
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 400,
    italic: false,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    lineHeight: null,
    letterSpacing: 0,
    maxLines: null,
    styleRuns: [],
    layoutMode: 'NONE',
    layoutWrap: 'NO_WRAP',
    primaryAxisAlign: 'MIN',
    counterAxisAlign: 'MIN',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    counterAxisSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    blendMode: 'PASS_THROUGH',
    layoutPositioning: 'AUTO',
    layoutGrow: 0,
    layoutAlignSelf: 'AUTO',
    vectorNetwork: null,
    arcData: null,
    horizontalConstraint: 'MIN',
    verticalConstraint: 'MIN',
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    dashPattern: [],
    borderTopWeight: 0,
    borderRightWeight: 0,
    borderBottomWeight: 0,
    borderLeftWeight: 0,
    independentStrokeWeights: false,
    strokeMiterLimit: 4,
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
    isMask: false,
    maskType: 'ALPHA',
    counterAxisAlignContent: 'AUTO',
    itemReverseZIndex: false,
    strokesIncludedInLayout: false,
    expanded: true,
    textTruncation: 'DISABLED',
    autoRename: true,
    pointCount: 5,
    starInnerRadius: 0.38,
    componentId: null,
    overrides: {},
    boundVariables: {},
    ...overrides
  }
}

function hexToColor(hex: string): Color {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

function solidFill(hex: string, opacity?: number): Fill {
  const color = hexToColor(hex)
  // Extract alpha from hex into fill opacity, keep color.a at 1
  const fillOpacity = opacity ?? color.a
  color.a = 1
  return { type: 'SOLID', color, opacity: fillOpacity, visible: true }
}

function solidStroke(hex: string, weight = 1, opacity = 1): Stroke {
  return { color: hexToColor(hex), weight, opacity, visible: true, align: 'CENTER' }
}

/**
 * Shared convenience property translation.
 * Converts shorthand props (fill, stroke, padding) and applies type-specific defaults.
 */
function applyConvenienceProps(type: string, props: Record<string, any>): Record<string, any> {
  const result = { ...props }

  // fill → fills
  if (result.fill) {
    result.fills = [solidFill(result.fill)]
    delete result.fill
  }

  // stroke → strokes
  if (result.stroke) {
    result.strokes = [solidStroke(result.stroke, result.strokeWeight ?? 1)]
    delete result.stroke
    delete result.strokeWeight
  }

  // padding → 4 sides
  if (result.padding !== undefined) {
    result.paddingTop = result.padding
    result.paddingRight = result.padding
    result.paddingBottom = result.padding
    result.paddingLeft = result.padding
    delete result.padding
  }

  // Type-specific defaults
  if (type === 'TEXT') {
    if (!result.width) result.width = 200
    if (!result.height) result.height = 24
    result.textAutoResize = 'HEIGHT'
    if (!result.fills || result.fills.length === 0) {
      result.fills = [solidFill('#000000')]
    }
  } else if (type === 'RECTANGLE' && (!result.fills || result.fills.length === 0)) {
    result.fills = [solidFill('#D9D9D9')]
  } else if (type === 'FRAME' && (!result.fills || result.fills.length === 0)) {
    result.fills = [solidFill('#FFFFFF')]
  }

  // Strip unsafe props that could override generated defaults in createDefaultNode
  for (const key of UNSAFE_PROPS) {
    delete result[key]
  }

  return result
}

// ============= Schemas =============

const sessionParamsDesc = {
  project: { type: 'string', description: 'Absolute path to project root' },
  session: { type: 'string', description: 'Session name. Either session or todoId is required.' },
  todoId: { type: 'number', description: 'Todo ID. Alternative to session.' },
}

export const addDesignNodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    type: {
      type: 'string',
      description: 'Node type',
      enum: ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE', 'GROUP', 'SECTION'],
    },
    parentId: { type: 'string', description: 'Parent node ID. Defaults to first page.' },
    name: { type: 'string', description: 'Node name' },
    x: { type: 'number', description: 'X position' },
    y: { type: 'number', description: 'Y position' },
    width: { type: 'number', description: 'Width' },
    height: { type: 'number', description: 'Height' },
    fill: { type: 'string', description: 'Fill color as hex (e.g. "#FF0000")' },
    stroke: { type: 'string', description: 'Stroke color as hex' },
    strokeWeight: { type: 'number', description: 'Stroke weight in pixels' },
    text: { type: 'string', description: 'Text content (for TEXT nodes)' },
    fontSize: { type: 'number', description: 'Font size (for TEXT nodes)' },
    fontWeight: { type: 'number', description: 'Font weight (for TEXT nodes)' },
    cornerRadius: { type: 'number', description: 'Corner radius' },
    opacity: { type: 'number', description: 'Opacity (0-1)' },
    rotation: { type: 'number', description: 'Rotation in degrees' },
    layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'], description: 'Auto layout direction (for FRAME nodes)' },
    primaryAxisAlign: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'], description: 'Align children along primary axis (start/center/end/space-between)' },
    counterAxisAlign: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'], description: 'Align children along counter axis (start/center/end/stretch)' },
    primaryAxisSizing: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'How frame sizes along primary axis. HUG=shrink to fit children, FILL=expand to fill parent' },
    counterAxisSizing: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'], description: 'How frame sizes along counter axis. HUG=shrink to fit children, FILL=expand to fill parent' },
    itemSpacing: { type: 'number', description: 'Spacing between children in auto layout (pixels)' },
    padding: { type: 'number', description: 'Uniform padding for auto layout (pixels). Sets all four sides.' },
    layoutGrow: { type: 'number', description: 'Flex grow factor for this node inside a parent auto-layout frame. 0=fixed size, 1=fill remaining space.' },
    layoutAlignSelf: { type: 'string', enum: ['AUTO', 'STRETCH'], description: 'Override counter-axis alignment for this child. STRETCH=fill parent cross-axis width.' },
    clipsContent: { type: 'boolean', description: 'Clip children to frame bounds (for FRAME nodes)' },
    textAlignHorizontal: { type: 'string', enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'], description: 'Horizontal text alignment (for TEXT nodes)' },
  },
  required: ['project', 'designId', 'type'],
}

export const updateDesignNodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Node ID to update' },
    properties: {
      type: 'object',
      description: 'Properties to update. Layout: layoutMode, primaryAxisAlign (MIN/CENTER/MAX/SPACE_BETWEEN), counterAxisAlign (MIN/CENTER/MAX/STRETCH), primaryAxisSizing (FIXED/HUG/FILL), counterAxisSizing (FIXED/HUG/FILL), itemSpacing, padding, layoutGrow, layoutAlignSelf (AUTO/STRETCH), clipsContent. Visual: x, y, width, height, name, fill, stroke, text, fontSize, fontWeight, cornerRadius, opacity, rotation, textAlignHorizontal (LEFT/CENTER/RIGHT).',
    },
  },
  required: ['project', 'designId', 'nodeId', 'properties'],
}

export const removeDesignNodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Node ID to remove' },
  },
  required: ['project', 'designId', 'nodeId'],
}

export const batchDesignOperationsSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    operations: {
      type: 'array',
      description: 'Array of operations to apply in order',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'update', 'remove'], description: 'Operation type' },
          type: { type: 'string', description: 'Node type (for add)' },
          nodeId: { type: 'string', description: 'Node ID (for update/remove). For add, a temp ID to reference in later ops.' },
          parentId: { type: 'string', description: 'Parent node ID (for add)' },
          properties: { type: 'object', description: 'Node properties' },
        },
        required: ['op'],
      },
    },
  },
  required: ['project', 'designId', 'operations'],
}

// ============= Handlers =============

export async function handleAddDesignNode(
  project: string,
  session: string,
  designId: string,
  args: Record<string, any>
): Promise<{ success: boolean; nodeId: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const parentId = args.parentId ?? findCurrentPage(graph)?.id
  if (!parentId) throw new Error('No parent found. Design may be empty.')

  // Extract known non-property args, pass the rest through convenience translation
  const { project: _p, session: _s, designId: _d, type: _t, parentId: _pid, todoId: _tid, ...rawProps } = args
  const overrides = applyConvenienceProps(args.type, rawProps)

  const node = createDefaultNode(args.type, overrides)
  node.parentId = parentId

  // Add to graph
  graph.nodes.push(node)
  const parent = graph.nodes.find(n => n.id === parentId)
  if (parent) {
    parent.childIds.push(node.id)
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, nodeId: node.id }
}

export async function handleUpdateDesignNode(
  project: string,
  session: string,
  designId: string,
  nodeId: string,
  properties: Record<string, any>
): Promise<{ success: boolean }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)

  // Handle convenience properties
  if (properties.fill) {
    properties.fills = [solidFill(properties.fill)]
    delete properties.fill
  }
  if (properties.stroke) {
    properties.strokes = [solidStroke(properties.stroke, properties.strokeWeight ?? node.strokes?.[0]?.weight ?? 1)]
    delete properties.stroke
    delete properties.strokeWeight
  }
  if (properties.padding !== undefined) {
    properties.paddingTop = properties.padding
    properties.paddingRight = properties.padding
    properties.paddingBottom = properties.padding
    properties.paddingLeft = properties.padding
    delete properties.padding
  }

  const safeProperties = { ...properties }
  for (const key of UNSAFE_PROPS) {
    delete safeProperties[key]
  }
  Object.assign(node, safeProperties)

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true }
}

export async function handleRemoveDesignNode(
  project: string,
  session: string,
  designId: string,
  nodeId: string
): Promise<{ success: boolean }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  // Collect all descendant IDs to remove
  const idsToRemove = new Set<string>()
  function collectDescendants(id: string) {
    idsToRemove.add(id)
    const n = graph.nodes.find(node => node.id === id)
    if (n) {
      for (const childId of n.childIds) {
        collectDescendants(childId)
      }
    }
  }
  collectDescendants(nodeId)

  // Remove from parent's childIds
  const node = graph.nodes.find(n => n.id === nodeId)
  if (node?.parentId) {
    const parent = graph.nodes.find(n => n.id === node.parentId)
    if (parent) {
      parent.childIds = parent.childIds.filter(id => id !== nodeId)
    }
  }

  // Remove all descendants
  graph.nodes = graph.nodes.filter(n => !idsToRemove.has(n.id))

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true }
}

export async function handleBatchDesignOperations(
  project: string,
  session: string,
  designId: string,
  operations: Array<{ op: string; type?: string; nodeId?: string; parentId?: string; properties?: Record<string, any> }>
): Promise<{ success: boolean; results: Array<{ op: string; nodeId?: string; success: boolean }> }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  // Map temp IDs to real IDs for referencing nodes added in earlier ops
  const idMap = new Map<string, string>()
  const results: Array<{ op: string; nodeId?: string; success: boolean }> = []

  for (const op of operations) {
    const resolveId = (id?: string) => id ? (idMap.get(id) ?? id) : id

    if (op.op === 'add' && op.type) {
      const parentId = resolveId(op.parentId) ?? findCurrentPage(graph)?.id
      if (!parentId) { results.push({ op: 'add', success: false }); continue }

      const props = applyConvenienceProps(op.type, { ...op.properties })

      const node = createDefaultNode(op.type, props)
      node.parentId = parentId
      graph.nodes.push(node)

      const parent = graph.nodes.find(n => n.id === parentId)
      if (parent) parent.childIds.push(node.id)

      if (op.nodeId) idMap.set(op.nodeId, node.id)
      results.push({ op: 'add', nodeId: node.id, success: true })

    } else if (op.op === 'update' && op.nodeId) {
      const realId = resolveId(op.nodeId)!
      const node = graph.nodes.find(n => n.id === realId)
      if (!node) { results.push({ op: 'update', nodeId: realId, success: false }); continue }

      const props = applyConvenienceProps(node.type, { ...op.properties })

      const safeProps = { ...props }
      for (const key of UNSAFE_PROPS) {
        delete safeProps[key]
      }
      Object.assign(node, safeProps)
      results.push({ op: 'update', nodeId: realId, success: true })

    } else if (op.op === 'remove' && op.nodeId) {
      const realId = resolveId(op.nodeId)!
      const idsToRemove = new Set<string>()
      function collect(id: string) {
        idsToRemove.add(id)
        const n = graph.nodes.find(node => node.id === id)
        if (n) for (const cid of n.childIds) collect(cid)
      }
      collect(realId)

      const target = graph.nodes.find(n => n.id === realId)
      if (target?.parentId) {
        const parent = graph.nodes.find(n => n.id === target.parentId)
        if (parent) parent.childIds = parent.childIds.filter(id => id !== realId)
      }
      graph.nodes = graph.nodes.filter(n => !idsToRemove.has(n.id))
      results.push({ op: 'remove', nodeId: realId, success: true })
    }
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, results }
}

// ============= New Schemas =============

export const getDesignNodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Node ID to inspect' },
  },
  required: ['project', 'designId', 'nodeId'],
}

export const listDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    parentId: { type: 'string', description: 'Parent node ID to list children of. Defaults to first page.' },
    depth: { type: 'number', description: 'Max depth to traverse (default: unlimited)' },
  },
  required: ['project', 'designId'],
}

export const groupDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to group' },
    name: { type: 'string', description: 'Group name (default: "Group")' },
  },
  required: ['project', 'designId', 'nodeIds'],
}

export const ungroupDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'GROUP node ID to ungroup' },
  },
  required: ['project', 'designId', 'nodeId'],
}

export const reorderDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to reorder' },
    direction: { type: 'string', enum: ['front', 'back', 'forward', 'backward'], description: 'Reorder direction' },
  },
  required: ['project', 'designId', 'nodeIds', 'direction'],
}

export const duplicateDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to duplicate' },
    offsetX: { type: 'number', description: 'X offset for duplicated nodes (default: 20)' },
    offsetY: { type: 'number', description: 'Y offset for duplicated nodes (default: 20)' },
  },
  required: ['project', 'designId', 'nodeIds'],
}

export const alignDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to align (minimum 2)' },
    action: {
      type: 'string',
      enum: ['left', 'centerH', 'right', 'top', 'centerV', 'bottom', 'distributeH', 'distributeV'],
      description: 'Alignment or distribution action',
    },
  },
  required: ['project', 'designId', 'nodeIds', 'action'],
}

export const transformDesignNodesSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to transform' },
    action: { type: 'string', enum: ['flipH', 'flipV'], description: 'Transform action' },
  },
  required: ['project', 'designId', 'nodeIds', 'action'],
}

// ============= New Handlers =============

export async function handleGetDesignNode(
  project: string,
  session: string,
  designId: string,
  nodeId: string
): Promise<{ success: boolean; node: SerializedNode | null }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  return { success: true, node }
}

export async function handleListDesignNodes(
  project: string,
  session: string,
  designId: string,
  parentId?: string,
  maxDepth?: number
): Promise<{ success: boolean; nodes: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number; depth: number; childCount: number }> }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const rootId = parentId ?? findCurrentPage(graph)?.id
  if (!rootId) throw new Error('No page found. Design may be empty.')

  const result: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number; depth: number; childCount: number }> = []

  function walk(nodeId: string, depth: number) {
    if (maxDepth !== undefined && depth > maxDepth) return
    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node) return
    result.push({
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      depth,
      childCount: node.childIds.length,
    })
    for (const childId of node.childIds) {
      walk(childId, depth + 1)
    }
  }

  const rootNode = graph.nodes.find(n => n.id === rootId)
  if (rootNode) {
    for (const childId of rootNode.childIds) {
      walk(childId, 0)
    }
  }

  return { success: true, nodes: result }
}

export async function handleGroupDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeIds: string[],
  name = 'Group'
): Promise<{ success: boolean; groupId: string }> {
  if (nodeIds.length === 0) throw new Error('nodeIds must not be empty')

  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  // Verify all nodes exist and share the same parent
  const nodes = nodeIds.map(id => {
    const n = graph.nodes.find(node => node.id === id)
    if (!n) throw new Error(`Node not found: ${id}`)
    return n
  })
  const parentId = nodes[0].parentId
  if (!nodes.every(n => n.parentId === parentId)) {
    throw new Error('All nodes must share the same parent to group')
  }
  const parent = graph.nodes.find(n => n.id === parentId)
  if (!parent) throw new Error('Parent not found')

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  // Create group node
  const group = createDefaultNode('GROUP', {
    name,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  })
  group.parentId = parentId

  // Insert group at the position of the first selected node
  const firstIndex = Math.min(...nodeIds.map(id => parent.childIds.indexOf(id)))
  parent.childIds = parent.childIds.filter(id => !nodeIds.includes(id))
  parent.childIds.splice(firstIndex, 0, group.id)

  // Reparent children into group, adjusting positions
  for (const n of nodes) {
    n.parentId = group.id
    n.x -= minX
    n.y -= minY
    group.childIds.push(n.id)
  }

  graph.nodes.push(group)
  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, groupId: group.id }
}

export async function handleUngroupDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeId: string
): Promise<{ success: boolean; childIds: string[] }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const group = graph.nodes.find(n => n.id === nodeId)
  if (!group) throw new Error(`Node not found: ${nodeId}`)
  if (group.type !== 'GROUP') throw new Error('Node is not a GROUP')

  const parentId = group.parentId
  if (!parentId) throw new Error('Group has no parent')
  const parent = graph.nodes.find(n => n.id === parentId)
  if (!parent) throw new Error('Parent not found')

  const childIds = [...group.childIds]
  const groupIndex = parent.childIds.indexOf(nodeId)

  // Reparent children to group's parent, adjusting positions
  for (let i = 0; i < childIds.length; i++) {
    const child = graph.nodes.find(n => n.id === childIds[i])
    if (child) {
      child.parentId = parentId
      child.x += group.x
      child.y += group.y
    }
  }

  // Replace group with its children in parent's childIds
  parent.childIds.splice(groupIndex, 1, ...childIds)

  // Remove the group node
  graph.nodes = graph.nodes.filter(n => n.id !== nodeId)

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, childIds }
}

export async function handleReorderDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeIds: string[],
  direction: 'front' | 'back' | 'forward' | 'backward'
): Promise<{ success: boolean }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  // Group nodeIds by parent for correct batch reordering
  const byParent = new Map<string, string[]>()
  for (const nodeId of nodeIds) {
    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node?.parentId) continue
    const arr = byParent.get(node.parentId) ?? []
    arr.push(nodeId)
    byParent.set(node.parentId, arr)
  }

  for (const [parentId, ids] of byParent) {
    const parent = graph.nodes.find(n => n.id === parentId)
    if (!parent) continue
    const idSet = new Set(ids)

    switch (direction) {
      case 'front': {
        const rest = parent.childIds.filter(id => !idSet.has(id))
        const moved = parent.childIds.filter(id => idSet.has(id))
        parent.childIds = [...rest, ...moved]
        break
      }
      case 'back': {
        const rest = parent.childIds.filter(id => !idSet.has(id))
        const moved = parent.childIds.filter(id => idSet.has(id))
        parent.childIds = [...moved, ...rest]
        break
      }
      case 'forward': {
        // Move each selected node one step toward the end, processing from end to avoid cascading
        const arr = [...parent.childIds]
        for (let i = arr.length - 2; i >= 0; i--) {
          if (idSet.has(arr[i]) && !idSet.has(arr[i + 1])) {
            ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
          }
        }
        parent.childIds = arr
        break
      }
      case 'backward': {
        // Move each selected node one step toward the start, processing from start to avoid cascading
        const arr = [...parent.childIds]
        for (let i = 1; i < arr.length; i++) {
          if (idSet.has(arr[i]) && !idSet.has(arr[i - 1])) {
            ;[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]
          }
        }
        parent.childIds = arr
        break
      }
    }
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true }
}

export async function handleDuplicateDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeIds: string[],
  offsetX = 20,
  offsetY = 20
): Promise<{ success: boolean; newNodeIds: string[] }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const newNodeIds: string[] = []
  const nodeIdSet = new Set(nodeIds)

  // Filter out nodes whose ancestors are already in the set (they'll be cloned as children)
  const topLevelIds = nodeIds.filter(id => {
    let current = graph.nodes.find(n => n.id === id)
    while (current?.parentId) {
      if (nodeIdSet.has(current.parentId)) return false
      current = graph.nodes.find(n => n.id === current!.parentId)
    }
    return true
  })

  for (const nodeId of topLevelIds) {
    const src = graph.nodes.find(n => n.id === nodeId)
    if (!src) throw new Error(`Node not found: ${nodeId}`)

    // Deep clone the node and all descendants
    const idMap = new Map<string, string>()

    function cloneNode(srcId: string): string {
      const srcNode = graph.nodes.find(n => n.id === srcId)
      if (!srcNode) throw new Error(`Node not found during clone: ${srcId}`)
      const newId = generateId()
      idMap.set(srcId, newId)

      const cloned: SerializedNode = JSON.parse(JSON.stringify(srcNode))
      cloned.id = newId
      cloned.childIds = []
      // Clone children recursively
      for (const childId of srcNode.childIds) {
        const newChildId = cloneNode(childId)
        cloned.childIds.push(newChildId)
        // Update child's parentId
        const clonedChild = graph.nodes.find(n => n.id === newChildId)
        if (clonedChild) clonedChild.parentId = newId
      }

      graph.nodes.push(cloned)
      return newId
    }

    const newId = cloneNode(nodeId)
    const clonedRoot = graph.nodes.find(n => n.id === newId)!
    clonedRoot.x += offsetX
    clonedRoot.y += offsetY
    clonedRoot.name = src.name + ' copy'
    // Keep original parent
    clonedRoot.parentId = src.parentId

    // Add to parent's childIds
    if (src.parentId) {
      const parent = graph.nodes.find(n => n.id === src.parentId)
      if (parent) {
        const idx = parent.childIds.indexOf(nodeId)
        parent.childIds.splice(idx + 1, 0, newId)
      }
    }

    newNodeIds.push(newId)
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, newNodeIds }
}

export async function handleAlignDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeIds: string[],
  action: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distributeH' | 'distributeV'
): Promise<{ success: boolean }> {
  if (nodeIds.length < 2) throw new Error('Need at least 2 nodes to align/distribute')

  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const nodes = nodeIds.map(id => {
    const n = graph.nodes.find(node => node.id === id)
    if (!n) throw new Error(`Node not found: ${id}`)
    return n
  })

  // Use absolute positions to handle nodes with different parents
  const absMap = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    absMap.set(n.id, getAbsolutePosition(graph, n.id))
  }

  // Helper: set absolute x for a node by adjusting its local x
  function setAbsX(n: SerializedNode, absX: number) {
    const abs = absMap.get(n.id)!
    n.x += absX - abs.x
    abs.x = absX
  }
  function setAbsY(n: SerializedNode, absY: number) {
    const abs = absMap.get(n.id)!
    n.y += absY - abs.y
    abs.y = absY
  }

  switch (action) {
    case 'left': {
      const min = Math.min(...nodes.map(n => absMap.get(n.id)!.x))
      for (const n of nodes) setAbsX(n, min)
      break
    }
    case 'centerH': {
      const min = Math.min(...nodes.map(n => absMap.get(n.id)!.x))
      const max = Math.max(...nodes.map(n => absMap.get(n.id)!.x + n.width))
      const center = (min + max) / 2
      for (const n of nodes) setAbsX(n, center - n.width / 2)
      break
    }
    case 'right': {
      const max = Math.max(...nodes.map(n => absMap.get(n.id)!.x + n.width))
      for (const n of nodes) setAbsX(n, max - n.width)
      break
    }
    case 'top': {
      const min = Math.min(...nodes.map(n => absMap.get(n.id)!.y))
      for (const n of nodes) setAbsY(n, min)
      break
    }
    case 'centerV': {
      const min = Math.min(...nodes.map(n => absMap.get(n.id)!.y))
      const max = Math.max(...nodes.map(n => absMap.get(n.id)!.y + n.height))
      const center = (min + max) / 2
      for (const n of nodes) setAbsY(n, center - n.height / 2)
      break
    }
    case 'bottom': {
      const max = Math.max(...nodes.map(n => absMap.get(n.id)!.y + n.height))
      for (const n of nodes) setAbsY(n, max - n.height)
      break
    }
    case 'distributeH': {
      if (nodes.length < 3) break
      const sorted = [...nodes].sort((a, b) => absMap.get(a.id)!.x - absMap.get(b.id)!.x)
      const firstX = absMap.get(sorted[0].id)!.x
      const lastX = absMap.get(sorted[sorted.length - 1].id)!.x + sorted[sorted.length - 1].width
      const totalWidth = sorted.reduce((s, n) => s + n.width, 0)
      const gap = (lastX - firstX - totalWidth) / (sorted.length - 1)
      let x = firstX
      for (const n of sorted) {
        setAbsX(n, x)
        x += n.width + gap
      }
      break
    }
    case 'distributeV': {
      if (nodes.length < 3) break
      const sorted = [...nodes].sort((a, b) => absMap.get(a.id)!.y - absMap.get(b.id)!.y)
      const firstY = absMap.get(sorted[0].id)!.y
      const lastY = absMap.get(sorted[sorted.length - 1].id)!.y + sorted[sorted.length - 1].height
      const totalHeight = sorted.reduce((s, n) => s + n.height, 0)
      const gap = (lastY - firstY - totalHeight) / (sorted.length - 1)
      let y = firstY
      for (const n of sorted) {
        setAbsY(n, y)
        y += n.height + gap
      }
      break
    }
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true }
}

export async function handleTransformDesignNodes(
  project: string,
  session: string,
  designId: string,
  nodeIds: string[],
  action: 'flipH' | 'flipV'
): Promise<{ success: boolean }> {
  if (nodeIds.length === 0) throw new Error('nodeIds must not be empty')

  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const nodes = nodeIds.map(id => {
    const n = graph.nodes.find(node => node.id === id)
    if (!n) throw new Error(`Node not found: ${id}`)
    return n
  })

  // Compute bounding box using absolute positions
  const absMap = new Map<string, { x: number; y: number }>()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    const abs = getAbsolutePosition(graph, n.id)
    absMap.set(n.id, abs)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + n.width)
    maxY = Math.max(maxY, abs.y + n.height)
  }

  for (const n of nodes) {
    const abs = absMap.get(n.id)!
    if (action === 'flipH') {
      const newAbsX = maxX - (abs.x - minX) - n.width
      n.x += newAbsX - abs.x
    } else {
      const newAbsY = maxY - (abs.y - minY) - n.height
      n.y += newAbsY - abs.y
    }
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true }
}

// ============= Advanced Schemas =============

export const createDesignFromTreeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    parentId: { type: 'string', description: 'Parent node ID. Defaults to first page.' },
    tree: {
      type: 'object',
      description: 'Recursive tree spec. Each node: { type, name?, width?, height?, fill?, stroke?, padding?, layoutMode?, children?: [...], ref?: string, ...any node property }. "ref" assigns a name to reference the created node ID in the result map.',
    },
  },
  required: ['project', 'designId', 'tree'],
}

export const addDesignImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    parentId: { type: 'string', description: 'Parent node ID. Defaults to first page.' },
    name: { type: 'string', description: 'Node name' },
    source: { type: 'string', description: 'Image source: URL (http/https), file path, or base64 data' },
    sourceType: { type: 'string', enum: ['url', 'file', 'base64'], description: 'How to interpret source. Default: auto-detect.' },
    width: { type: 'number', description: 'Width (default: 200)' },
    height: { type: 'number', description: 'Height (default: 200)' },
    x: { type: 'number', description: 'X position' },
    y: { type: 'number', description: 'Y position' },
    imageScaleMode: { type: 'string', enum: ['FILL', 'FIT', 'CROP', 'TILE'], description: 'Image scale mode (default: FILL)' },
  },
  required: ['project', 'designId', 'source'],
}

export const setNodeImageSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Node ID to set image on' },
    source: { type: 'string', description: 'Image source: URL (http/https), file path, or base64 data' },
    sourceType: { type: 'string', enum: ['url', 'file', 'base64'], description: 'How to interpret source. Default: auto-detect.' },
    imageScaleMode: { type: 'string', enum: ['FILL', 'FIT', 'CROP', 'TILE'], description: 'Image scale mode (default: FILL)' },
  },
  required: ['project', 'designId', 'nodeId', 'source'],
}

export const exportDesignSvgSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Root node to export. Defaults to first page.' },
    outputPath: { type: 'string', description: 'File path to save SVG. If omitted, returns SVG string only.' },
  },
  required: ['project', 'designId'],
}

export const exportDesignCodeSchema = {
  type: 'object',
  properties: {
    ...sessionParamsDesc,
    designId: { type: 'string', description: 'Design ID' },
    nodeId: { type: 'string', description: 'Root node to export. Defaults to first page.' },
    framework: { type: 'string', enum: ['react', 'html'], description: 'Output framework (default: react)' },
    outputPath: { type: 'string', description: 'File path to save code. If omitted, returns code string only.' },
  },
  required: ['project', 'designId'],
}

// ============= Advanced Handlers =============

export async function handleCreateDesignFromTree(
  project: string,
  session: string,
  designId: string,
  tree: Record<string, any>,
  parentId?: string
): Promise<{ success: boolean; nodeIds: Record<string, string>; rootNodeId: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const resolvedParentId = parentId ?? findCurrentPage(graph)?.id
  if (!resolvedParentId) throw new Error('No parent found. Design may be empty.')

  const nodeIds: Record<string, string> = {}
  let rootNodeId = ''

  function buildNode(spec: Record<string, any>, pId: string): string {
    const { children, ref, type, ...rawProps } = spec
    if (!type) throw new Error('Each tree node must have a "type" property')

    const props = applyConvenienceProps(type, rawProps)
    const node = createDefaultNode(type, props)
    node.parentId = pId

    graph.nodes.push(node)
    const parent = graph.nodes.find(n => n.id === pId)
    if (parent) parent.childIds.push(node.id)

    if (ref) nodeIds[ref] = node.id
    if (spec.name) nodeIds[spec.name] = node.id

    if (children && Array.isArray(children)) {
      for (const child of children) {
        buildNode(child, node.id)
      }
    }

    return node.id
  }

  rootNodeId = buildNode(tree, resolvedParentId)

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, nodeIds, rootNodeId }
}

// Image loading helper
async function loadImageBytes(source: string, sourceType?: string): Promise<Buffer> {
  const detectedType = sourceType ?? (
    source.startsWith('http://') || source.startsWith('https://') ? 'url' :
    source.startsWith('data:') || (source.length > 500 && !source.includes('/')) ? 'base64' :
    'file'
  )

  switch (detectedType) {
    case 'url': {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    }
    case 'file': {
      return Buffer.from(await readFile(source))
    }
    case 'base64': {
      const data = source.replace(/^data:[^;]+;base64,/, '')
      return Buffer.from(data, 'base64')
    }
    default:
      throw new Error(`Unknown sourceType: ${detectedType}`)
  }
}

function addImageToGraph(graph: SerializedGraph, imageBytes: Buffer): { imageHash: string; base64: string } {
  const imageHash = createHash('sha256').update(imageBytes).digest('hex')
  const base64 = imageBytes.toString('base64')

  if (!graph.images) graph.images = []
  const existing = graph.images.find(img => img.key === imageHash)
  if (!existing) {
    graph.images.push({ key: imageHash, value: base64 })
  }

  return { imageHash, base64 }
}

export async function handleAddDesignImage(
  project: string,
  session: string,
  designId: string,
  args: Record<string, any>
): Promise<{ success: boolean; nodeId: string; imageHash: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const parentId = args.parentId ?? findCurrentPage(graph)?.id
  if (!parentId) throw new Error('No parent found. Design may be empty.')

  const imageBytes = await loadImageBytes(args.source, args.sourceType)
  const { imageHash } = addImageToGraph(graph, imageBytes)

  const scaleMode = args.imageScaleMode ?? 'FILL'
  const node = createDefaultNode('FRAME', {
    name: args.name ?? 'Image',
    x: args.x ?? 0,
    y: args.y ?? 0,
    width: args.width ?? 200,
    height: args.height ?? 200,
    clipsContent: true,
    fills: [{
      type: 'IMAGE',
      imageHash,
      imageScaleMode: scaleMode,
      opacity: 1,
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0 },
    }],
  })
  node.parentId = parentId

  graph.nodes.push(node)
  const parent = graph.nodes.find(n => n.id === parentId)
  if (parent) parent.childIds.push(node.id)

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, nodeId: node.id, imageHash }
}

export async function handleSetNodeImage(
  project: string,
  session: string,
  designId: string,
  nodeId: string,
  source: string,
  sourceType?: string,
  imageScaleMode?: string
): Promise<{ success: boolean; imageHash: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)

  const imageBytes = await loadImageBytes(source, sourceType)
  const { imageHash } = addImageToGraph(graph, imageBytes)

  const scaleMode = imageScaleMode ?? 'FILL'
  const imageFill = {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: scaleMode,
    opacity: 1,
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0 },
  }

  // Replace existing IMAGE fill or add new one
  const existingIdx = node.fills.findIndex((f: any) => f.type === 'IMAGE')
  if (existingIdx >= 0) {
    node.fills[existingIdx] = imageFill as any
  } else {
    node.fills.push(imageFill as any)
  }

  await handleUpdateDesign(project, session, designId, graph)
  return { success: true, imageHash }
}

// ============= SVG Export =============

function colorToCSS(color: Color, opacity = 1): string {
  const r = Math.round(color.r * 255)
  const g = Math.round(color.g * 255)
  const b = Math.round(color.b * 255)
  const a = opacity * color.a
  if (a < 1) return `rgba(${r},${g},${b},${+a.toFixed(3)})`
  return `rgb(${r},${g},${b})`
}

function nodeToSVG(node: SerializedNode, graph: SerializedGraph, defs: string[]): string {
  if (!node.visible) return ''
  const opacity = node.opacity < 1 ? ` opacity="${node.opacity}"` : ''
  const transform = node.rotation ? ` transform="rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})"` : ''

  // Determine fill
  let fillAttr = 'fill="none"'
  if (node.fills.length > 0) {
    const fill = node.fills.find((f: any) => f.visible !== false)
    if (fill) {
      if (fill.type === 'SOLID') {
        fillAttr = `fill="${colorToCSS(fill.color, fill.opacity)}"`
      } else if (fill.type === 'IMAGE' && (fill as any).imageHash) {
        const img = graph.images?.find(i => i.key === (fill as any).imageHash)
        if (img) {
          const patId = `pat_${node.id}`
          defs.push(`<pattern id="${patId}" patternUnits="objectBoundingBox" width="1" height="1"><image href="data:image/png;base64,${img.value}" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid slice"/></pattern>`)
          fillAttr = `fill="url(#${patId})"`
        }
      }
    }
  }

  // Determine stroke
  let strokeAttr = ''
  if (node.strokes.length > 0) {
    const stroke = node.strokes.find((s: any) => s.visible !== false)
    if (stroke) {
      strokeAttr = ` stroke="${colorToCSS(stroke.color, stroke.opacity)}" stroke-width="${stroke.weight}"`
    }
  }

  const cr = node.cornerRadius
  const rx = cr > 0 ? ` rx="${cr}" ry="${cr}"` : ''

  switch (node.type) {
    case 'RECTANGLE':
    case 'SECTION':
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rx} ${fillAttr}${strokeAttr}${opacity}${transform}/>`

    case 'ELLIPSE': {
      const cx = node.x + node.width / 2
      const cy = node.y + node.height / 2
      return `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}" ${fillAttr}${strokeAttr}${opacity}${transform}/>`
    }

    case 'TEXT': {
      const textFill = node.fills.length > 0 && node.fills[0].type === 'SOLID'
        ? `fill="${colorToCSS(node.fills[0].color, node.fills[0].opacity)}"`
        : 'fill="black"'
      const anchor = node.textAlignHorizontal === 'CENTER' ? 'middle' : node.textAlignHorizontal === 'RIGHT' ? 'end' : 'start'
      const textX = anchor === 'middle' ? node.x + node.width / 2 : anchor === 'end' ? node.x + node.width : node.x
      return `<text x="${textX}" y="${node.y + node.fontSize}" font-family="${node.fontFamily}" font-size="${node.fontSize}" font-weight="${node.fontWeight}" text-anchor="${anchor}" ${textFill}${opacity}${transform}>${escapeXml(node.text)}</text>`
    }

    case 'LINE':
      return `<line x1="${node.x}" y1="${node.y}" x2="${node.x + node.width}" y2="${node.y + node.height}"${strokeAttr || ' stroke="black" stroke-width="1"'}${opacity}${transform}/>`

    case 'FRAME':
    case 'GROUP': {
      // Children have positions relative to this node, so wrap in a translate group
      const childTranslate = `translate(${node.x},${node.y})`
      const children = node.childIds
        .map(id => graph.nodes.find(n => n.id === id))
        .filter(Boolean)
        .map(child => nodeToSVG(child!, graph, defs))
        .join('\n')

      if (node.type === 'GROUP') {
        return `<g transform="${childTranslate}"${opacity}${transform}>\n${children}\n</g>`
      }

      // FRAME: render background rect + clipped children in translated group
      const clipId = node.clipsContent ? `clip_${node.id}` : ''
      if (clipId) {
        // Clip rect at origin since children are translated
        defs.push(`<clipPath id="${clipId}"><rect x="0" y="0" width="${node.width}" height="${node.height}"${rx}/></clipPath>`)
      }
      const bg = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rx} ${fillAttr}${strokeAttr}/>`
      const clipAttr = clipId ? ` clip-path="url(#${clipId})"` : ''
      return `<g${opacity}${transform}>\n${bg}\n<g transform="${childTranslate}"${clipAttr}>\n${children}\n</g>\n</g>`
    }

    default:
      return `<!-- unsupported type: ${node.type} -->`
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function handleExportDesignSvg(
  project: string,
  session: string,
  designId: string,
  nodeId?: string,
  outputPath?: string
): Promise<{ success: boolean; svg: string; outputPath?: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const rootId = nodeId ?? findCurrentPage(graph)?.id
  if (!rootId) throw new Error('No page found. Design may be empty.')
  const rootNode = graph.nodes.find(n => n.id === rootId)
  if (!rootNode) throw new Error(`Node not found: ${rootId}`)

  const defs: string[] = []
  const childrenSvg = rootNode.childIds
    .map(id => graph.nodes.find(n => n.id === id))
    .filter(Boolean)
    .map(child => nodeToSVG(child!, graph, defs))
    .join('\n')

  const defsBlock = defs.length > 0 ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rootNode.width}" height="${rootNode.height}" viewBox="0 0 ${rootNode.width} ${rootNode.height}">\n${defsBlock}${childrenSvg}\n</svg>`

  if (outputPath) {
    await writeFile(outputPath, svg, 'utf-8')
    return { success: true, svg, outputPath }
  }

  return { success: true, svg }
}

// ============= Code Export =============

// Style helpers for code export

interface StyleMap {
  [key: string]: string | number
}

function getVisibleFill(fills: Fill[]): Fill | null {
  if (!fills || fills.length === 0) return null
  return fills.find((f: any) => f.visible !== false) ?? null
}

function getVisibleStroke(strokes: Stroke[]): Stroke | null {
  if (!strokes || strokes.length === 0) return null
  return strokes.find((s: any) => s.visible !== false) ?? null
}

function buildStyleMap(node: SerializedNode): StyleMap {
  const s: StyleMap = {}

  s.width = node.width
  s.height = node.height

  if (node.opacity < 1) s.opacity = node.opacity
  if (node.cornerRadius > 0) s.borderRadius = node.cornerRadius
  if (node.rotation) s.transform = `rotate(${node.rotation}deg)`

  const fill = getVisibleFill(node.fills)
  if (fill && fill.type === 'SOLID') {
    s.backgroundColor = colorToCSS(fill.color, fill.opacity)
  }

  const stroke = getVisibleStroke(node.strokes)
  if (stroke) {
    s.borderWidth = stroke.weight
    s.borderStyle = 'solid'
    s.borderColor = colorToCSS(stroke.color, stroke.opacity)
  }

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    s.display = 'flex'
    s.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column'

    const justifyMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' }
    if (node.primaryAxisAlign && justifyMap[node.primaryAxisAlign]) {
      s.justifyContent = justifyMap[node.primaryAxisAlign]
    }

    const alignMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline' }
    if (node.counterAxisAlign && alignMap[node.counterAxisAlign]) {
      s.alignItems = alignMap[node.counterAxisAlign]
    }

    if (node.itemSpacing > 0) s.gap = node.itemSpacing
  }

  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    if (node.paddingTop === node.paddingRight && node.paddingRight === node.paddingBottom && node.paddingBottom === node.paddingLeft) {
      s.padding = node.paddingTop
    } else {
      s.paddingTop = node.paddingTop
      s.paddingRight = node.paddingRight
      s.paddingBottom = node.paddingBottom
      s.paddingLeft = node.paddingLeft
    }
  }

  if (node.clipsContent) s.overflow = 'hidden'
  if (node.layoutGrow === 1) s.flex = 1

  return s
}

function buildTextStyleMap(node: SerializedNode, base: StyleMap): StyleMap {
  const s = { ...base }
  s.fontFamily = node.fontFamily
  s.fontSize = node.fontSize
  s.fontWeight = node.fontWeight
  if (node.textAlignHorizontal !== 'LEFT') {
    s.textAlign = node.textAlignHorizontal.toLowerCase()
  }
  const fill = getVisibleFill(node.fills)
  if (fill && fill.type === 'SOLID') {
    s.color = colorToCSS(fill.color, fill.opacity)
    delete s.backgroundColor  // text uses color, not background
  }
  return s
}

function styleMapToReact(styles: StyleMap): string {
  const entries = Object.entries(styles).map(([k, v]) => {
    if (typeof v === 'number') return `${k}: ${v}`
    return `${k}: ${JSON.stringify(v)}`
  })
  return `{ ${entries.join(', ')} }`
}

function styleMapToHTML(styles: StyleMap): string {
  // Convert camelCase to kebab-case CSS
  const entries = Object.entries(styles).map(([k, v]) => {
    const cssKey = k.replace(/([A-Z])/g, '-$1').toLowerCase()
    if (typeof v === 'number' && !['opacity', 'flex', 'fontWeight'].includes(k)) {
      return `${cssKey}: ${v}px`
    }
    return `${cssKey}: ${v}`
  })
  return entries.join('; ')
}

function nodeToCode(
  node: SerializedNode,
  graph: SerializedGraph,
  framework: 'react' | 'html',
  indent: number
): string {
  if (!node.visible) return ''
  const pad = '  '.repeat(indent)

  const styles = buildStyleMap(node)

  if (node.type === 'TEXT') {
    const textStyles = buildTextStyleMap(node, styles)

    if (framework === 'react') {
      const styleStr = ` style={${styleMapToReact(textStyles)}}`
      return `${pad}<span${styleStr}>{${JSON.stringify(node.text)}}</span>`
    }
    const styleStr = ` style="${styleMapToHTML(textStyles)}"`
    return `${pad}<span${styleStr}>${escapeXml(node.text)}</span>`
  }

  const children = node.childIds
    .map(id => graph.nodes.find(n => n.id === id))
    .filter(Boolean)
    .map(child => nodeToCode(child!, graph, framework, indent + 1))
    .filter(Boolean)
    .join('\n')

  const tag = 'div'

  if (framework === 'react') {
    const styleStr = ` style={${styleMapToReact(styles)}}`
    if (children) {
      return `${pad}<${tag}${styleStr}>\n${children}\n${pad}</${tag}>`
    }
    return `${pad}<${tag}${styleStr} />`
  }

  const styleStr = ` style="${styleMapToHTML(styles)}"`
  if (children) {
    return `${pad}<${tag}${styleStr}>\n${children}\n${pad}</${tag}>`
  }
  return `${pad}<${tag}${styleStr}></${tag}>`
}

export async function handleExportDesignCode(
  project: string,
  session: string,
  designId: string,
  nodeId?: string,
  framework: 'react' | 'html' = 'react',
  _styling?: string,
  outputPath?: string
): Promise<{ success: boolean; code: string; outputPath?: string }> {
  const design = await handleGetDesign(project, session, designId)
  const content = typeof design.content === 'string' ? JSON.parse(design.content) : design.content
  const graph = getGraph(content)

  const rootId = nodeId ?? findCurrentPage(graph)?.id
  if (!rootId) throw new Error('No page found. Design may be empty.')
  const rootNode = graph.nodes.find(n => n.id === rootId)
  if (!rootNode) throw new Error(`Node not found: ${rootId}`)

  const children = rootNode.childIds
    .map(id => graph.nodes.find(n => n.id === id))
    .filter(Boolean)
    .map(child => nodeToCode(child!, graph, framework, 1))
    .filter(Boolean)
    .join('\n')

  let code: string
  if (framework === 'react') {
    let componentName = (rootNode.name || 'Design').replace(/[^a-zA-Z0-9]/g, '')
    // Ensure valid React component name: must start with uppercase letter
    if (!componentName || /^[0-9]/.test(componentName)) {
      componentName = 'Design' + componentName
    }
    componentName = componentName.charAt(0).toUpperCase() + componentName.slice(1)
    code = `export function ${componentName}() {\n  return (\n    <div style={{ width: ${rootNode.width}, height: ${rootNode.height} }}>\n${children}\n    </div>\n  );\n}`
  } else {
    code = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><title>${escapeXml(rootNode.name || 'Design')}</title></head>\n<body>\n  <div style="width: ${rootNode.width}px; height: ${rootNode.height}px;">\n${children}\n  </div>\n</body>\n</html>`
  }

  if (outputPath) {
    await writeFile(outputPath, code, 'utf-8')
    return { success: true, code, outputPath }
  }

  return { success: true, code }
}
