/**
 * Design Editor Store
 *
 * Zustand store for the design editor UI state.
 * Ported from open-pencil's Vue reactive store.
 *
 * Non-serializable objects (SceneGraph, SkiaRenderer, UndoManager, etc.)
 * live in designEditorRefs.ts as module-level singletons.
 */

import { create } from 'zustand'
import { getEditorRefs } from './designEditorRefs'
import type { SceneNode, NodeType, LayoutMode, Fill, VectorNetwork, VectorRegion } from '@/engine/scene-graph'
import { computeVectorBounds } from '@/engine/vector'
import type { SnapGuide } from '@/engine/snap'
import type { Color, Rect } from '@/engine/types'
import { computeLayout } from '@/engine/layout'
import {
  CANVAS_BG_COLOR,
  ZOOM_SENSITIVITY,
  DEFAULT_SHAPE_FILL,
  DEFAULT_FRAME_FILL,
  SECTION_DEFAULT_FILL,
  SECTION_DEFAULT_STROKE,
} from '@/engine/constants'

export type Tool =
  | 'SELECT'
  | 'FRAME'
  | 'SECTION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'LINE'
  | 'POLYGON'
  | 'STAR'
  | 'TEXT'
  | 'PEN'
  | 'HAND'

const BLACK_FILL: Fill = {
  type: 'SOLID',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
}

const DEFAULT_FILLS: Record<string, Fill> = {
  FRAME: DEFAULT_FRAME_FILL,
  SECTION: SECTION_DEFAULT_FILL,
  RECTANGLE: DEFAULT_SHAPE_FILL,
  ELLIPSE: DEFAULT_SHAPE_FILL,
  POLYGON: DEFAULT_SHAPE_FILL,
  STAR: DEFAULT_SHAPE_FILL,
  LINE: BLACK_FILL,
  TEXT: BLACK_FILL,
}

export interface DesignEditorState {
  // View state
  activeTool: Tool
  currentPageId: string
  panX: number
  panY: number
  zoom: number
  pageColor: Color
  showUI: boolean

  // Selection
  selectedIds: Set<string>
  hoveredNodeId: string | null
  editingTextId: string | null

  // Overlays
  marquee: Rect | null
  snapGuides: SnapGuide[]
  rotationPreview: { nodeId: string; angle: number } | null
  dropTargetId: string | null
  layoutInsertIndicator: {
    parentId: string
    index: number
    x: number
    y: number
    length: number
    direction: 'HORIZONTAL' | 'VERTICAL'
  } | null

  // Pen tool
  penState: {
    vertices: Array<{ x: number; y: number }>
    segments: Array<{
      start: number
      end: number
      tangentStart: { x: number; y: number }
      tangentEnd: { x: number; y: number }
    }>
    dragTangent: { x: number; y: number } | null
    closingToFirst: boolean
  } | null
  penCursorX: number | null
  penCursorY: number | null

  // Multiplayer
  remoteCursors: Array<{
    name: string
    color: Color
    x: number
    y: number
    selection?: string[]
  }>

  // Versioning (triggers render/save)
  renderVersion: number
  sceneVersion: number

  // --- Actions ---
  requestRender: () => void
  requestRepaint: () => void
  setTool: (tool: Tool) => void
  select: (ids: string[], additive?: boolean) => void
  clearSelection: () => void
  selectAll: () => void
  setMarquee: (rect: Rect | null) => void
  setSnapGuides: (guides: SnapGuide[]) => void
  setRotationPreview: (preview: { nodeId: string; angle: number } | null) => void
  setHoveredNode: (id: string | null) => void
  setDropTarget: (id: string | null) => void
  setLayoutInsertIndicator: (indicator: DesignEditorState['layoutInsertIndicator']) => void

  // Node operations
  updateNode: (id: string, changes: Partial<SceneNode>) => void
  updateNodeWithUndo: (id: string, changes: Partial<SceneNode>, label?: string) => void
  commitNodeUpdate: (id: string, previous: Partial<SceneNode>, label?: string) => void
  createShape: (type: NodeType, x: number, y: number, w: number, h: number, parentId?: string) => string
  deleteSelected: () => void
  duplicateSelected: () => void

  // Undo/redo
  undoAction: () => void
  redoAction: () => void

  // Move/resize commits
  commitMove: (originals: Map<string, { x: number; y: number }>) => void
  commitResize: (nodeId: string, origRect: Rect) => void
  commitRotation: (nodeId: string, origRotation: number) => void

  // Text editing
  startTextEditing: (nodeId: string) => void
  commitTextEdit: () => void

  // Group operations
  groupSelected: () => void
  ungroupSelected: () => void
  bringToFront: () => void
  sendToBack: () => void

  // Auto-layout
  setLayoutMode: (id: string, mode: LayoutMode) => void

  // Pen tool
  penAddVertex: (x: number, y: number) => void
  penSetDragTangent: (tx: number, ty: number) => void
  penSetClosingToFirst: (closing: boolean) => void
  penCommit: (closed: boolean) => void
  penCancel: () => void

  // Reparenting & reordering
  isTopLevel: (parentId: string | null) => boolean
  reparentNodes: (nodeIds: string[], newParentId: string) => void
  reorderInAutoLayout: (nodeId: string, parentId: string, insertIndex: number) => void
  adoptNodesIntoSection: (sectionId: string) => void

  // Zoom/pan
  applyZoom: (delta: number, centerX: number, centerY: number) => void
  pan: (dx: number, dy: number) => void
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number }

  // Computed helpers
  getSelectedNodes: () => SceneNode[]
  getSelectedNode: () => SceneNode | undefined
  getLayerTree: () => Array<{ node: SceneNode; depth: number }>
}

export const useDesignEditorStore = create<DesignEditorState>((set, get) => {
  function runLayoutForNode(id: string) {
    const { graph } = getEditorRefs()
    const node = graph.getNode(id)
    if (!node) return
    if (node.layoutMode !== 'NONE') {
      computeLayout(graph, id)
    }
    let parent = node.parentId ? graph.getNode(node.parentId) : undefined
    while (parent) {
      if (parent.layoutMode !== 'NONE') {
        computeLayout(graph, parent.id)
      }
      parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
    }
  }

  function syncIfInsideComponent(nodeId: string) {
    const { graph } = getEditorRefs()
    let current = graph.getNode(nodeId)
    while (current) {
      if (current.type === 'COMPONENT') {
        graph.syncInstances(current.id)
        return
      }
      current = current.parentId ? graph.getNode(current.parentId) : undefined
    }
  }

  return {
    // Initial state
    activeTool: 'SELECT',
    currentPageId: '',
    panX: 0,
    panY: 0,
    zoom: 1,
    pageColor: { ...CANVAS_BG_COLOR },
    showUI: true,
    selectedIds: new Set<string>(),
    hoveredNodeId: null,
    editingTextId: null,
    marquee: null,
    snapGuides: [],
    rotationPreview: null,
    dropTargetId: null,
    layoutInsertIndicator: null,
    penState: null,
    penCursorX: null,
    penCursorY: null,
    remoteCursors: [],
    renderVersion: 0,
    sceneVersion: 0,

    // --- Actions ---

    requestRender: () =>
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 })),

    requestRepaint: () =>
      set((s) => ({ renderVersion: s.renderVersion + 1 })),

    setTool: (tool) => set({ activeTool: tool }),

    select: (ids, additive = false) => {
      if (additive) {
        set((s) => {
          const next = new Set(s.selectedIds)
          for (const id of ids) {
            if (next.has(id)) next.delete(id)
            else next.add(id)
          }
          return { selectedIds: next }
        })
      } else {
        set({ selectedIds: new Set(ids) })
      }
    },

    clearSelection: () => set({ selectedIds: new Set() }),

    selectAll: () => {
      const { graph } = getEditorRefs()
      const { currentPageId } = get()
      const children = graph.getChildren(currentPageId)
      set({ selectedIds: new Set(children.map((n) => n.id)) })
    },

    setMarquee: (rect) => {
      set((s) => ({ marquee: rect, renderVersion: s.renderVersion + 1 }))
    },

    setSnapGuides: (guides) => {
      set((s) => ({ snapGuides: guides, renderVersion: s.renderVersion + 1 }))
    },

    setRotationPreview: (preview) => {
      set((s) => ({ rotationPreview: preview, renderVersion: s.renderVersion + 1 }))
    },

    setHoveredNode: (id) => {
      if (get().hoveredNodeId === id) return
      set((s) => ({ hoveredNodeId: id, renderVersion: s.renderVersion + 1 }))
    },

    setDropTarget: (id) => {
      set((s) => ({ dropTargetId: id, renderVersion: s.renderVersion + 1 }))
    },

    setLayoutInsertIndicator: (indicator) => {
      set((s) => ({ layoutInsertIndicator: indicator, renderVersion: s.renderVersion + 1 }))
    },

    // --- Node operations ---

    updateNode: (id, changes) => {
      const { graph, renderer } = getEditorRefs()
      graph.updateNode(id, changes)
      if ('vectorNetwork' in changes) {
        renderer?.invalidateVectorPath(id)
      }
      runLayoutForNode(id)
      syncIfInsideComponent(id)
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    updateNodeWithUndo: (id, changes, label = 'Update') => {
      const { graph, undo } = getEditorRefs()
      const node = graph.getNode(id)
      if (!node) return
      const previous: Partial<SceneNode> = {}
      for (const key of Object.keys(changes) as (keyof SceneNode)[]) {
        ;(previous as Record<string, unknown>)[key] = node[key]
      }
      graph.updateNode(id, changes)
      if ('vectorNetwork' in changes) {
        const { renderer } = getEditorRefs()
        renderer?.invalidateVectorPath(id)
      }
      runLayoutForNode(id)
      syncIfInsideComponent(id)
      undo.push({
        label,
        forward: () => {
          const { renderer } = getEditorRefs()
          graph.updateNode(id, changes)
          if ('vectorNetwork' in changes) renderer?.invalidateVectorPath(id)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
        inverse: () => {
          const { renderer } = getEditorRefs()
          graph.updateNode(id, previous)
          if ('vectorNetwork' in previous) renderer?.invalidateVectorPath(id)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    commitNodeUpdate: (id, previous, label = 'Update') => {
      const { graph, undo } = getEditorRefs()
      const node = graph.getNode(id)
      if (!node) return
      const current: Partial<SceneNode> = {}
      for (const key of Object.keys(previous) as (keyof SceneNode)[]) {
        ;(current as Record<string, unknown>)[key] = node[key]
      }
      undo.push({
        label,
        forward: () => {
          const { renderer } = getEditorRefs()
          graph.updateNode(id, current)
          if ('vectorNetwork' in current) renderer?.invalidateVectorPath(id)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
        inverse: () => {
          const { renderer } = getEditorRefs()
          graph.updateNode(id, previous)
          if ('vectorNetwork' in previous) renderer?.invalidateVectorPath(id)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    createShape: (type, x, y, w, h, parentId) => {
      const { graph, undo } = getEditorRefs()
      const { currentPageId } = get()
      const fill = DEFAULT_FILLS[type] ?? DEFAULT_FILLS.RECTANGLE
      const pid = parentId ?? currentPageId
      const overrides: Partial<SceneNode> = {
        x, y, width: w, height: h,
        fills: [{ ...fill }],
      }
      if (type === 'SECTION') {
        overrides.strokes = [{ ...SECTION_DEFAULT_STROKE }]
        overrides.cornerRadius = 5
      }
      if (type === 'POLYGON') overrides.pointCount = 3
      if (type === 'STAR') {
        overrides.pointCount = 5
        overrides.starInnerRadius = 0.38
      }
      const node = graph.createNode(type, pid, overrides)
      const id = node.id
      const snapshot = { ...node }
      runLayoutForNode(pid)
      syncIfInsideComponent(id)
      undo.push({
        label: `Create ${type.toLowerCase()}`,
        forward: () => {
          graph.createNode(snapshot.type, pid, snapshot)
          runLayoutForNode(pid)
          syncIfInsideComponent(id)
          get().requestRender()
        },
        inverse: () => {
          graph.deleteNode(id)
          runLayoutForNode(pid)
          set((s) => {
            const next = new Set(s.selectedIds)
            next.delete(id)
            return { selectedIds: next }
          })
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
      return id
    },

    deleteSelected: () => {
      const { graph, undo } = getEditorRefs()
      const { selectedIds } = get()
      const entries: Array<{ id: string; parentId: string; snapshot: SceneNode; index: number }> = []
      for (const id of selectedIds) {
        const node = graph.getNode(id)
        if (!node) continue
        const parentId = node.parentId ?? get().currentPageId
        const parent = graph.getNode(parentId)
        const index = parent?.childIds.indexOf(id) ?? -1
        entries.push({ id, parentId, snapshot: { ...node }, index })
      }
      if (entries.length === 0) return

      const prevSelection = new Set(selectedIds)
      for (const { id } of entries) graph.deleteNode(id)

      undo.push({
        label: 'Delete',
        forward: () => {
          for (const { id, parentId } of entries) {
            graph.deleteNode(id)
            runLayoutForNode(parentId)
          }
          set({ selectedIds: new Set() })
          get().requestRender()
        },
        inverse: () => {
          for (const { snapshot, parentId, index } of [...entries].reverse()) {
            graph.createNode(snapshot.type, parentId, snapshot)
            if (index >= 0) graph.reorderChild(snapshot.id, parentId, index)
            runLayoutForNode(snapshot.id)
            syncIfInsideComponent(snapshot.id)
          }
          set({ selectedIds: prevSelection })
          get().requestRender()
        },
      })
      set((s) => ({
        selectedIds: new Set(),
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    duplicateSelected: () => {
      const { graph, undo } = getEditorRefs()
      const { selectedIds, currentPageId } = get()
      const prevSelection = new Set(selectedIds)
      const newIds: string[] = []
      const snapshots: Array<{ snapshot: SceneNode; parentId: string }> = []

      for (const id of selectedIds) {
        const src = graph.getNode(id)
        if (!src) continue
        const parentId = src.parentId ?? currentPageId
        const { id: _srcId, parentId: _srcParent, childIds: _srcChildren, ...srcRest } = src
        const node = graph.createNode(src.type, parentId, {
          ...srcRest,
          name: src.name + ' copy',
          x: src.x + 20,
          y: src.y + 20,
        })
        newIds.push(node.id)
        snapshots.push({ snapshot: { ...node }, parentId })
        syncIfInsideComponent(node.id)
      }

      if (newIds.length > 0) {
        undo.push({
          label: 'Duplicate',
          forward: () => {
            for (const { snapshot, parentId } of snapshots) {
              graph.createNode(snapshot.type, parentId, snapshot)
              runLayoutForNode(snapshot.id)
              syncIfInsideComponent(snapshot.id)
            }
            set({ selectedIds: new Set(newIds) })
            get().requestRender()
          },
          inverse: () => {
            for (let i = 0; i < newIds.length; i++) {
              const parentId = snapshots[i].parentId
              graph.deleteNode(newIds[i])
              runLayoutForNode(parentId)
            }
            set({ selectedIds: prevSelection })
            get().requestRender()
          },
        })
        set((s) => ({
          selectedIds: new Set(newIds),
          renderVersion: s.renderVersion + 1,
          sceneVersion: s.sceneVersion + 1,
        }))
      }
    },

    // --- Undo/redo ---

    undoAction: () => {
      const { undo } = getEditorRefs()
      undo.undo()
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    redoAction: () => {
      const { undo } = getEditorRefs()
      undo.redo()
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    // --- Move/resize commits ---

    commitMove: (originals) => {
      const { graph, undo } = getEditorRefs()
      const finals = new Map<string, { x: number; y: number }>()
      for (const [id] of originals) {
        const n = graph.getNode(id)
        if (n) finals.set(id, { x: n.x, y: n.y })
      }
      for (const [id] of finals) syncIfInsideComponent(id)
      undo.push({
        label: 'Move',
        forward: () => {
          for (const [id, pos] of finals) {
            graph.updateNode(id, pos)
            runLayoutForNode(id)
          }
          for (const [id] of finals) syncIfInsideComponent(id)
          get().requestRender()
        },
        inverse: () => {
          for (const [id, pos] of originals) {
            graph.updateNode(id, pos)
            runLayoutForNode(id)
          }
          for (const [id] of originals) syncIfInsideComponent(id)
          get().requestRender()
        },
      })
    },

    commitResize: (nodeId, origRect) => {
      const { graph, undo } = getEditorRefs()
      const node = graph.getNode(nodeId)
      if (!node) return
      const finalRect = { x: node.x, y: node.y, width: node.width, height: node.height }
      syncIfInsideComponent(nodeId)
      undo.push({
        label: 'Resize',
        forward: () => {
          graph.updateNode(nodeId, finalRect)
          runLayoutForNode(nodeId)
          syncIfInsideComponent(nodeId)
          get().requestRender()
        },
        inverse: () => {
          graph.updateNode(nodeId, origRect)
          runLayoutForNode(nodeId)
          syncIfInsideComponent(nodeId)
          get().requestRender()
        },
      })
    },

    commitRotation: (nodeId, origRotation) => {
      const { graph, undo } = getEditorRefs()
      const node = graph.getNode(nodeId)
      if (!node) return
      const finalRotation = node.rotation
      syncIfInsideComponent(nodeId)
      undo.push({
        label: 'Rotate',
        forward: () => {
          graph.updateNode(nodeId, { rotation: finalRotation })
          syncIfInsideComponent(nodeId)
          get().requestRender()
        },
        inverse: () => {
          graph.updateNode(nodeId, { rotation: origRotation })
          syncIfInsideComponent(nodeId)
          get().requestRender()
        },
      })
    },

    // --- Text editing ---

    startTextEditing: (nodeId) => {
      const state = get()
      if (state.editingTextId) state.commitTextEdit()
      const { graph, textEditor, renderer } = getEditorRefs()
      const node = graph.getNode(nodeId)
      if (!node) return
      if (textEditor && renderer) {
        textEditor.setRenderer(renderer)
        textEditor.start(node)
      }
      set((s) => ({
        editingTextId: nodeId,
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    commitTextEdit: () => {
      const { graph, textEditor, undo } = getEditorRefs()
      if (!textEditor?.isActive) {
        set({ editingTextId: null })
        return
      }
      const result = textEditor.stop()
      if (!result) {
        set((s) => ({ editingTextId: null, renderVersion: s.renderVersion + 1 }))
        return
      }
      const node = graph.getNode(result.nodeId)
      const prevText = node?.text ?? ''
      const newText = result.text
      graph.updateNode(result.nodeId, { text: newText })
      if (prevText !== newText) {
        undo.push({
          label: 'Edit text',
          forward: () => {
            graph.updateNode(result.nodeId, { text: newText })
            runLayoutForNode(result.nodeId)
            syncIfInsideComponent(result.nodeId)
            get().requestRender()
          },
          inverse: () => {
            graph.updateNode(result.nodeId, { text: prevText })
            runLayoutForNode(result.nodeId)
            syncIfInsideComponent(result.nodeId)
            get().requestRender()
          },
        })
      }
      set((s) => ({
        editingTextId: null,
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    // --- Group operations ---

    groupSelected: () => {
      const { graph, undo } = getEditorRefs()
      const state = get()
      const nodes = state.getSelectedNodes()
      if (nodes.length === 0) return

      const parentId = nodes[0].parentId ?? state.currentPageId
      const sameParent = nodes.every((n) => (n.parentId ?? state.currentPageId) === parentId)
      if (!sameParent) return
      const parent = graph.getNode(parentId)
      if (!parent) return

      const prevSelection = new Set(state.selectedIds)
      const nodeIds = nodes.map((n) => n.id)
      const origPositions = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of nodes) {
        const abs = graph.getAbsolutePosition(n.id)
        minX = Math.min(minX, abs.x)
        minY = Math.min(minY, abs.y)
        maxX = Math.max(maxX, abs.x + n.width)
        maxY = Math.max(maxY, abs.y + n.height)
      }

      const parentAbs = parent.type === 'CANVAS' ? { x: 0, y: 0 } : graph.getAbsolutePosition(parentId)
      const firstIndex = Math.min(...nodeIds.map((id) => parent.childIds.indexOf(id)))

      const group = graph.createNode('GROUP', parentId, {
        name: 'Group',
        x: minX - parentAbs.x, y: minY - parentAbs.y,
        width: maxX - minX, height: maxY - minY,
        fills: [],
      })
      const groupId = group.id
      parent.childIds = parent.childIds.filter((id) => id !== groupId)
      parent.childIds.splice(firstIndex, 0, groupId)
      for (const n of nodes) graph.reparentNode(n.id, groupId)

      undo.push({
        label: 'Group',
        forward: () => {
          const { childIds: _ch, ...groupRest } = group
          const g = graph.createNode('GROUP', parentId, { ...groupRest, childIds: [] })
          parent.childIds = parent.childIds.filter((id) => id !== g.id)
          parent.childIds.splice(firstIndex, 0, g.id)
          for (const n of origPositions) {
            graph.reparentNode(n.id, g.id)
            syncIfInsideComponent(n.id)
          }
          set({ selectedIds: new Set([g.id]) })
          get().requestRender()
        },
        inverse: () => {
          for (const orig of origPositions) {
            graph.reparentNode(orig.id, parentId)
            graph.updateNode(orig.id, { x: orig.x, y: orig.y })
            syncIfInsideComponent(orig.id)
          }
          graph.deleteNode(groupId)
          set({ selectedIds: prevSelection })
          get().requestRender()
        },
      })
      set((s) => ({
        selectedIds: new Set([groupId]),
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    ungroupSelected: () => {
      const { graph, undo } = getEditorRefs()
      const state = get()
      const node = state.getSelectedNode()
      if (!node || node.type !== 'GROUP') return

      const parentId = node.parentId ?? state.currentPageId
      const parent = graph.getNode(parentId)
      if (!parent) return

      const groupIndex = parent.childIds.indexOf(node.id)
      const childIds = [...node.childIds]
      const prevSelection = new Set(state.selectedIds)
      const groupId = node.id
      const groupSnapshot = { ...node, childIds: [] as string[] }

      for (let i = 0; i < childIds.length; i++) {
        graph.reparentNode(childIds[i], parentId)
        parent.childIds = parent.childIds.filter((id) => id !== childIds[i])
        parent.childIds.splice(groupIndex + i, 0, childIds[i])
      }
      graph.deleteNode(groupId)

      undo.push({
        label: 'Ungroup',
        forward: () => {
          const p = graph.getNode(parentId)
          if (!p) return
          for (let i = 0; i < childIds.length; i++) {
            graph.reparentNode(childIds[i], parentId)
            p.childIds = p.childIds.filter((id) => id !== childIds[i])
            p.childIds.splice(groupIndex + i, 0, childIds[i])
            syncIfInsideComponent(childIds[i])
          }
          graph.deleteNode(groupId)
          set({ selectedIds: new Set(childIds) })
          get().requestRender()
        },
        inverse: () => {
          // Recreate the group and reparent children back into it
          const { parentId: _p, childIds: _c, ...rest } = groupSnapshot
          const group = graph.createNode('GROUP', parentId, { ...rest })
          // Move group to original position in parent's childIds
          const p = graph.getNode(parentId)
          if (p) {
            p.childIds = p.childIds.filter((id) => id !== group.id)
            p.childIds.splice(groupIndex, 0, group.id)
          }
          for (const childId of childIds) {
            graph.reparentNode(childId, group.id)
            syncIfInsideComponent(childId)
          }
          set({ selectedIds: prevSelection })
          get().requestRender()
        },
      })
      set((s) => ({
        selectedIds: new Set(childIds),
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    bringToFront: () => {
      const { graph, undo } = getEditorRefs()
      const { selectedIds } = get()
      if (selectedIds.size === 0) return
      const origOrders = new Map<string, string[]>()
      for (const id of selectedIds) {
        const node = graph.getNode(id)
        if (!node?.parentId) continue
        const parent = graph.getNode(node.parentId)
        if (!parent) continue
        if (!origOrders.has(node.parentId)) origOrders.set(node.parentId, [...parent.childIds])
        if (parent.childIds.indexOf(id) === parent.childIds.length - 1) continue
        parent.childIds = parent.childIds.filter((cid) => cid !== id)
        parent.childIds.push(id)
      }
      const finalOrders = new Map<string, string[]>()
      for (const [pid] of origOrders) {
        const p = graph.getNode(pid)
        if (p) finalOrders.set(pid, [...p.childIds])
      }
      undo.push({
        label: 'Bring to front',
        forward: () => {
          for (const [pid, order] of finalOrders) {
            const p = graph.getNode(pid)
            if (p) p.childIds = [...order]
          }
          get().requestRender()
        },
        inverse: () => {
          for (const [pid, order] of origOrders) {
            const p = graph.getNode(pid)
            if (p) p.childIds = [...order]
          }
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    sendToBack: () => {
      const { graph, undo } = getEditorRefs()
      const { selectedIds } = get()
      if (selectedIds.size === 0) return
      const origOrders = new Map<string, string[]>()
      for (const id of selectedIds) {
        const node = graph.getNode(id)
        if (!node?.parentId) continue
        const parent = graph.getNode(node.parentId)
        if (!parent) continue
        if (!origOrders.has(node.parentId)) origOrders.set(node.parentId, [...parent.childIds])
        if (parent.childIds.indexOf(id) === 0) continue
        parent.childIds = parent.childIds.filter((cid) => cid !== id)
        parent.childIds.unshift(id)
      }
      const finalOrders = new Map<string, string[]>()
      for (const [pid] of origOrders) {
        const p = graph.getNode(pid)
        if (p) finalOrders.set(pid, [...p.childIds])
      }
      undo.push({
        label: 'Send to back',
        forward: () => {
          for (const [pid, order] of finalOrders) {
            const p = graph.getNode(pid)
            if (p) p.childIds = [...order]
          }
          get().requestRender()
        },
        inverse: () => {
          for (const [pid, order] of origOrders) {
            const p = graph.getNode(pid)
            if (p) p.childIds = [...order]
          }
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    // --- Auto-layout ---

    setLayoutMode: (id, mode) => {
      const { graph, undo } = getEditorRefs()
      const node = graph.getNode(id)
      if (!node) return

      const previous: Partial<SceneNode> = {
        layoutMode: node.layoutMode,
        itemSpacing: node.itemSpacing,
        paddingTop: node.paddingTop,
        paddingRight: node.paddingRight,
        paddingBottom: node.paddingBottom,
        paddingLeft: node.paddingLeft,
        primaryAxisSizing: node.primaryAxisSizing,
        counterAxisSizing: node.counterAxisSizing,
        width: node.width,
        height: node.height,
      }

      const updates: Partial<SceneNode> = { layoutMode: mode }
      if (mode !== 'NONE' && node.layoutMode === 'NONE') {
        updates.itemSpacing = 0
        updates.paddingTop = 0
        updates.paddingRight = 0
        updates.paddingBottom = 0
        updates.paddingLeft = 0
        updates.primaryAxisSizing = 'HUG'
        updates.counterAxisSizing = 'HUG'
      }

      graph.updateNode(id, updates)
      if (mode !== 'NONE') computeLayout(graph, id)
      runLayoutForNode(id)
      syncIfInsideComponent(id)

      const updated = graph.getNode(id)
      if (!updated) return
      const finalState: Partial<SceneNode> = {}
      for (const key of Object.keys(previous) as (keyof SceneNode)[]) {
        ;(finalState as Record<string, unknown>)[key] = updated[key]
      }

      undo.push({
        label: mode === 'NONE' ? 'Remove auto layout' : 'Add auto layout',
        forward: () => {
          graph.updateNode(id, finalState)
          if (mode !== 'NONE') computeLayout(graph, id)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
        inverse: () => {
          graph.updateNode(id, previous)
          runLayoutForNode(id)
          syncIfInsideComponent(id)
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    // --- Pen tool ---

    penAddVertex: (x, y) => {
      const state = get()
      if (!state.penState) {
        set((s) => ({
          penState: {
            vertices: [{ x, y }],
            segments: [],
            dragTangent: null,
            closingToFirst: false,
          },
          renderVersion: s.renderVersion + 1,
        }))
        return
      }

      const ps = { ...state.penState }
      const prevIdx = ps.vertices.length - 1
      const first = ps.vertices[0]
      const dist = Math.hypot(x - first.x, y - first.y)

      if (ps.vertices.length > 2 && dist < 8) {
        ps.segments = [
          ...ps.segments,
          {
            start: prevIdx,
            end: 0,
            tangentStart: ps.dragTangent ?? { x: 0, y: 0 },
            tangentEnd: { x: 0, y: 0 },
          },
        ]
        set({ penState: ps })
        get().penCommit(true)
        return
      }

      ps.vertices = [...ps.vertices, { x, y }]
      const newIdx = ps.vertices.length - 1
      ps.segments = [
        ...ps.segments,
        {
          start: prevIdx,
          end: newIdx,
          tangentStart: ps.dragTangent ?? { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 },
        },
      ]
      ps.dragTangent = null
      set((s) => ({ penState: ps, renderVersion: s.renderVersion + 1 }))
    },

    penSetDragTangent: (tx, ty) => {
      const { penState } = get()
      if (!penState) return
      const ps = { ...penState }
      ps.dragTangent = { x: tx, y: ty }
      if (ps.segments.length > 0) {
        const segs = [...ps.segments]
        segs[segs.length - 1] = { ...segs[segs.length - 1], tangentEnd: { x: -tx, y: -ty } }
        ps.segments = segs
      }
      set((s) => ({ penState: ps, renderVersion: s.renderVersion + 1 }))
    },

    penSetClosingToFirst: (closing) => {
      const { penState } = get()
      if (!penState) return
      set((s) => ({
        penState: { ...penState, closingToFirst: closing },
        renderVersion: s.renderVersion + 1,
      }))
    },

    penCommit: (closed) => {
      const { graph, undo } = getEditorRefs()
      const { penState, currentPageId } = get()
      if (!penState || penState.vertices.length < 2) {
        set((s) => ({
          penState: null,
          penCursorX: null,
          penCursorY: null,
          renderVersion: s.renderVersion + 1,
        }))
        return
      }

      const regions: VectorRegion[] = closed
        ? [{ windingRule: 'NONZERO', loops: [penState.segments.map((_, i) => i)] }]
        : []

      const network: VectorNetwork = {
        vertices: penState.vertices,
        segments: penState.segments,
        regions,
      }

      const bounds = computeVectorBounds(network)
      const normalizedVertices = network.vertices.map((v) => ({
        ...v,
        x: v.x - bounds.x,
        y: v.y - bounds.y,
      }))

      const normalizedNetwork: VectorNetwork = {
        vertices: normalizedVertices,
        segments: network.segments,
        regions,
      }

      const node = graph.createNode('VECTOR', currentPageId, {
        name: 'Vector',
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        vectorNetwork: normalizedNetwork,
        fills: closed
          ? [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
          : [],
        strokes: closed
          ? []
          : [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'CENTER' as const }],
      })

      const nodeId = node.id
      undo.push({
        label: 'Draw path',
        forward: () => {
          graph.createNode('VECTOR', currentPageId, { ...node })
          get().requestRender()
        },
        inverse: () => {
          graph.deleteNode(nodeId)
          set((s) => {
            const next = new Set(s.selectedIds)
            next.delete(nodeId)
            return { selectedIds: next }
          })
          get().requestRender()
        },
      })

      set((s) => ({
        penState: null,
        penCursorX: null,
        penCursorY: null,
        selectedIds: new Set([nodeId]),
        activeTool: 'SELECT',
        renderVersion: s.renderVersion + 1,
        sceneVersion: s.sceneVersion + 1,
      }))
    },

    penCancel: () => {
      set((s) => ({
        penState: null,
        penCursorX: null,
        penCursorY: null,
        activeTool: 'SELECT',
        renderVersion: s.renderVersion + 1,
      }))
    },

    // --- Reparenting & reordering ---

    isTopLevel: (parentId) => {
      const { graph } = getEditorRefs()
      const { currentPageId } = get()
      return !parentId || parentId === graph.rootId || parentId === currentPageId
    },

    reparentNodes: (nodeIds, newParentId) => {
      const { graph, undo } = getEditorRefs()
      const parent = graph.getNode(newParentId)
      const origParents: Array<{ id: string; parentId: string; x: number; y: number }> = []
      for (const id of nodeIds) {
        const node = graph.getNode(id)
        if (!node) continue
        if (
          node.type === 'SECTION' &&
          parent &&
          parent.type !== 'CANVAS' &&
          parent.type !== 'SECTION'
        ) continue
        origParents.push({ id, parentId: node.parentId ?? get().currentPageId, x: node.x, y: node.y })
        graph.reparentNode(id, newParentId)
      }
      if (origParents.length === 0) {
        set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
        return
      }
      const finals = origParents.map(({ id }) => {
        const n = graph.getNode(id)
        return { id, x: n?.x ?? 0, y: n?.y ?? 0 }
      })
      undo.push({
        label: 'Reparent',
        forward: () => {
          for (const f of finals) {
            graph.reparentNode(f.id, newParentId)
            graph.updateNode(f.id, { x: f.x, y: f.y })
          }
          get().requestRender()
        },
        inverse: () => {
          for (const orig of origParents) {
            graph.reparentNode(orig.id, orig.parentId)
            graph.updateNode(orig.id, { x: orig.x, y: orig.y })
          }
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    reorderInAutoLayout: (nodeId, parentId, insertIndex) => {
      const { graph, undo } = getEditorRefs()
      const parent = graph.getNode(parentId)
      if (!parent || parent.layoutMode === 'NONE') return
      const node = graph.getNode(nodeId)
      if (!node) return

      const origParentId = node.parentId ?? get().currentPageId
      const origPos = { x: node.x, y: node.y }
      const origParentChildren = parent ? [...parent.childIds] : []
      const origOrigParentChildren = origParentId !== parentId ? [...(graph.getNode(origParentId)?.childIds ?? [])] : null

      if (node.parentId !== parentId) {
        const absPos = graph.getAbsolutePosition(nodeId)
        const parentAbs = graph.getAbsolutePosition(parentId)
        graph.updateNode(nodeId, { x: absPos.x - parentAbs.x, y: absPos.y - parentAbs.y })
        graph.reparentNode(nodeId, parentId)
      }
      graph.reorderChild(nodeId, parentId, insertIndex)
      computeLayout(graph, parentId)
      runLayoutForNode(parentId)

      const finalPos = { x: node.x, y: node.y }
      const finalChildren = [...parent.childIds]

      undo.push({
        label: 'Reorder',
        forward: () => {
          if (origParentId !== parentId) graph.reparentNode(nodeId, parentId)
          const p = graph.getNode(parentId)
          if (p) p.childIds = [...finalChildren]
          graph.updateNode(nodeId, finalPos)
          computeLayout(graph, parentId)
          runLayoutForNode(parentId)
          get().requestRender()
        },
        inverse: () => {
          if (origParentId !== parentId) {
            graph.reparentNode(nodeId, origParentId)
            if (origOrigParentChildren) {
              const op = graph.getNode(origParentId)
              if (op) op.childIds = [...origOrigParentChildren]
            }
          }
          const p = graph.getNode(parentId)
          if (p) p.childIds = [...origParentChildren]
          graph.updateNode(nodeId, origPos)
          computeLayout(graph, parentId)
          runLayoutForNode(parentId)
          get().requestRender()
        },
      })
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    adoptNodesIntoSection: (sectionId) => {
      const { graph } = getEditorRefs()
      const { currentPageId } = get()
      const section = graph.getNode(sectionId)
      if (!section || section.type !== 'SECTION') return

      const parentId = section.parentId ?? currentPageId
      const siblings = graph.getChildren(parentId)

      const sx = section.x
      const sy = section.y
      const sx2 = sx + section.width
      const sy2 = sy + section.height

      for (const sibling of siblings) {
        if (sibling.id === sectionId) continue
        if (
          sibling.x >= sx &&
          sibling.y >= sy &&
          sibling.x + sibling.width <= sx2 &&
          sibling.y + sibling.height <= sy2
        ) {
          graph.reparentNode(sibling.id, sectionId)
        }
      }
      set((s) => ({ renderVersion: s.renderVersion + 1, sceneVersion: s.sceneVersion + 1 }))
    },

    // --- Zoom/pan ---

    applyZoom: (delta, centerX, centerY) => {
      set((s) => {
        const factor = Math.pow(ZOOM_SENSITIVITY, delta)
        const newZoom = Math.max(0.02, Math.min(256, s.zoom * factor))
        return {
          panX: centerX - (centerX - s.panX) * (newZoom / s.zoom),
          panY: centerY - (centerY - s.panY) * (newZoom / s.zoom),
          zoom: newZoom,
          renderVersion: s.renderVersion + 1,
        }
      })
    },

    pan: (dx, dy) => {
      set((s) => ({
        panX: s.panX + dx,
        panY: s.panY + dy,
        renderVersion: s.renderVersion + 1,
      }))
    },

    screenToCanvas: (sx, sy) => {
      const { panX, panY, zoom } = get()
      return { x: (sx - panX) / zoom, y: (sy - panY) / zoom }
    },

    // --- Computed helpers ---

    getSelectedNodes: () => {
      const { graph } = getEditorRefs()
      const { selectedIds } = get()
      const nodes: SceneNode[] = []
      for (const id of selectedIds) {
        const n = graph.getNode(id)
        if (n) nodes.push({ ...n })
      }
      return nodes
    },

    getSelectedNode: () => {
      const nodes = get().getSelectedNodes()
      return nodes.length === 1 ? nodes[0] : undefined
    },

    getLayerTree: () => {
      const { graph } = getEditorRefs()
      const { currentPageId } = get()
      return graph.flattenTree(currentPageId)
    },
  }
})
