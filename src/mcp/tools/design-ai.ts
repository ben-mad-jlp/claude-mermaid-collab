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
  return { r, g, b, a: 1 }
}

function solidFill(hex: string, opacity = 1): Fill {
  return { type: 'SOLID', color: hexToColor(hex), opacity, visible: true }
}

function solidStroke(hex: string, weight = 1, opacity = 1): Stroke {
  return { color: hexToColor(hex), weight, opacity, visible: true, align: 'CENTER' }
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

  const overrides: Partial<SerializedNode> = {}
  if (args.name) overrides.name = args.name
  if (args.x !== undefined) overrides.x = args.x
  if (args.y !== undefined) overrides.y = args.y
  if (args.width !== undefined) overrides.width = args.width
  if (args.height !== undefined) overrides.height = args.height
  if (args.rotation !== undefined) overrides.rotation = args.rotation
  if (args.opacity !== undefined) overrides.opacity = args.opacity
  if (args.cornerRadius !== undefined) overrides.cornerRadius = args.cornerRadius
  if (args.text) overrides.text = args.text
  if (args.fontSize) overrides.fontSize = args.fontSize
  if (args.fontWeight) overrides.fontWeight = args.fontWeight
  if (args.fill) overrides.fills = [solidFill(args.fill)]
  if (args.stroke) {
    overrides.strokes = [solidStroke(args.stroke, args.strokeWeight ?? 1)]
  }
  if (args.layoutMode) overrides.layoutMode = args.layoutMode
  if (args.primaryAxisAlign) overrides.primaryAxisAlign = args.primaryAxisAlign
  if (args.counterAxisAlign) overrides.counterAxisAlign = args.counterAxisAlign
  if (args.primaryAxisSizing) overrides.primaryAxisSizing = args.primaryAxisSizing
  if (args.counterAxisSizing) overrides.counterAxisSizing = args.counterAxisSizing
  if (args.itemSpacing !== undefined) overrides.itemSpacing = args.itemSpacing
  if (args.padding !== undefined) {
    overrides.paddingTop = args.padding
    overrides.paddingRight = args.padding
    overrides.paddingBottom = args.padding
    overrides.paddingLeft = args.padding
  }
  if (args.layoutGrow !== undefined) overrides.layoutGrow = args.layoutGrow
  if (args.layoutAlignSelf) overrides.layoutAlignSelf = args.layoutAlignSelf
  if (args.clipsContent !== undefined) overrides.clipsContent = args.clipsContent
  if (args.textAlignHorizontal) overrides.textAlignHorizontal = args.textAlignHorizontal

  // Text defaults
  if (args.type === 'TEXT') {
    if (!overrides.width) overrides.width = 200
    if (!overrides.height) overrides.height = 24
    overrides.textAutoResize = 'HEIGHT'
    if (!overrides.fills || overrides.fills.length === 0) {
      overrides.fills = [solidFill('#000000')]
    }
  }

  // Rectangle defaults
  if (args.type === 'RECTANGLE' && (!overrides.fills || overrides.fills.length === 0)) {
    overrides.fills = [solidFill('#D9D9D9')]
  }

  // Frame defaults
  if (args.type === 'FRAME' && (!overrides.fills || overrides.fills.length === 0)) {
    overrides.fills = [solidFill('#FFFFFF')]
  }

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

      const props = { ...op.properties }
      if (props?.fill) { props.fills = [solidFill(props.fill)]; delete props.fill }
      if (props?.stroke) { props.strokes = [solidStroke(props.stroke, props.strokeWeight ?? 1)]; delete props.stroke; delete props.strokeWeight }
      if (props?.padding !== undefined) {
        props.paddingTop = props.padding; props.paddingRight = props.padding
        props.paddingBottom = props.padding; props.paddingLeft = props.padding
        delete props.padding
      }

      // Type-specific defaults
      if (op.type === 'TEXT') {
        if (!props.width) props.width = 200
        if (!props.height) props.height = 24
        props.textAutoResize = 'HEIGHT'
        if (!props.fills) props.fills = [solidFill('#000000')]
      } else if (op.type === 'RECTANGLE' && !props.fills) {
        props.fills = [solidFill('#D9D9D9')]
      } else if (op.type === 'FRAME' && !props.fills) {
        props.fills = [solidFill('#FFFFFF')]
      }

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

      const props = { ...op.properties }
      if (props?.fill) { props.fills = [solidFill(props.fill)]; delete props.fill }
      if (props?.stroke) { props.strokes = [solidStroke(props.stroke, props.strokeWeight ?? 1)]; delete props.stroke; delete props.strokeWeight }
      if (props?.padding !== undefined) {
        props.paddingTop = props.padding; props.paddingRight = props.padding
        props.paddingBottom = props.padding; props.paddingLeft = props.padding
        delete props.padding
      }

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
