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
    itemSpacing: { type: 'number', description: 'Item spacing for auto layout' },
    padding: { type: 'number', description: 'Uniform padding for auto layout' },
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
      description: 'Properties to update (x, y, width, height, name, fill, stroke, text, fontSize, cornerRadius, opacity, rotation, layoutMode, itemSpacing, etc.)',
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
  if (args.itemSpacing !== undefined) overrides.itemSpacing = args.itemSpacing
  if (args.padding !== undefined) {
    overrides.paddingTop = args.padding
    overrides.paddingRight = args.padding
    overrides.paddingBottom = args.padding
    overrides.paddingLeft = args.padding
  }

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
