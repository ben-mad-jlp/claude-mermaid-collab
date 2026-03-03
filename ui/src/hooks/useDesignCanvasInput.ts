/**
 * useDesignCanvasInput Hook
 *
 * Handles all mouse, touch, and gesture input on the design editor canvas.
 * Implements a drag state machine for: select, draw, move, pan, resize,
 * rotate, marquee, pen, and text-select interactions.
 *
 * Ported from open-pencil's use-canvas-input.ts (Vue composable -> React hook).
 */

import { useEffect, useRef, useCallback } from 'react'
import { computeSelectionBounds, computeSnap } from '@/engine/snap'
import type { NodeType, SceneNode } from '@/engine/scene-graph'
import type { Rect } from '@/engine/types'
import {
  AUTO_LAYOUT_BREAK_THRESHOLD,
  HANDLE_HIT_RADIUS,
  ROTATION_HIT_RADIUS,
  PEN_CLOSE_THRESHOLD,
  ROTATION_SNAP_DEGREES,
  ROTATION_HIT_OFFSET,
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TEXT_HEIGHT,
} from '@/engine/constants'
import { getEditorRefs } from '@/stores/designEditorRefs'
import { useDesignEditorStore, type Tool } from '@/stores/designEditorStore'

type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragDraw { type: 'draw'; startX: number; startY: number; nodeId: string }
interface DragMove {
  type: 'move'; startX: number; startY: number
  originals: Map<string, { x: number; y: number }>
  duplicated?: boolean; autoLayoutParentId?: string; brokeFromAutoLayout?: boolean
}
interface DragPan { type: 'pan'; startScreenX: number; startScreenY: number; startPanX: number; startPanY: number }
interface DragResize { type: 'resize'; handle: HandlePosition; startX: number; startY: number; origRect: Rect; nodeId: string }
interface DragMarquee { type: 'marquee'; startX: number; startY: number }
interface DragRotate { type: 'rotate'; nodeId: string; centerX: number; centerY: number; startAngle: number; origRotation: number }
interface DragPen { type: 'pen-drag'; startX: number; startY: number }
interface DragTextSelect { type: 'text-select'; startX: number; startY: number }

type DragState = DragDraw | DragMove | DragPan | DragResize | DragMarquee | DragRotate | DragPen | DragTextSelect

const TOOL_TO_NODE: Partial<Record<Tool, NodeType>> = {
  FRAME: 'FRAME', SECTION: 'SECTION', RECTANGLE: 'RECTANGLE', ELLIPSE: 'ELLIPSE',
  LINE: 'LINE', POLYGON: 'POLYGON', STAR: 'STAR', TEXT: 'TEXT',
}

const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
}

function getScreenRect(absX: number, absY: number, w: number, h: number, zoom: number, panX: number, panY: number) {
  return {
    x1: absX * zoom + panX, y1: absY * zoom + panY,
    x2: (absX + w) * zoom + panX, y2: (absY + h) * zoom + panY,
  }
}

function getHandlePositions(absX: number, absY: number, w: number, h: number, zoom: number, panX: number, panY: number) {
  const { x1, y1, x2, y2 } = getScreenRect(absX, absY, w, h, zoom, panX, panY)
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return {
    nw: { x: x1, y: y1 }, n: { x: mx, y: y1 }, ne: { x: x2, y: y1 }, e: { x: x2, y: my },
    se: { x: x2, y: y2 }, s: { x: mx, y: y2 }, sw: { x: x1, y: y2 }, w: { x: x1, y: my },
  } as Record<HandlePosition, { x: number; y: number }>
}

function unrotate(sx: number, sy: number, centerX: number, centerY: number, rotation: number) {
  if (rotation === 0) return { sx, sy }
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = sx - centerX
  const dy = sy - centerY
  return { sx: centerX + dx * cos - dy * sin, sy: centerY + dx * sin + dy * cos }
}

function hitTestHandle(sx: number, sy: number, absX: number, absY: number, w: number, h: number, zoom: number, panX: number, panY: number, rotation = 0): HandlePosition | null {
  const { x1, y1, x2, y2 } = getScreenRect(absX, absY, w, h, zoom, panX, panY)
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const ur = unrotate(sx, sy, cx, cy, rotation)
  const handles = getHandlePositions(absX, absY, w, h, zoom, panX, panY)
  for (const [pos, pt] of Object.entries(handles)) {
    if (Math.abs(ur.sx - pt.x) < HANDLE_HIT_RADIUS && Math.abs(ur.sy - pt.y) < HANDLE_HIT_RADIUS) {
      return pos as HandlePosition
    }
  }
  return null
}

function hitTestRotationHandle(sx: number, sy: number, absX: number, absY: number, w: number, h: number, zoom: number, panX: number, panY: number, rotation = 0): boolean {
  const { x1, x2, y1, y2 } = getScreenRect(absX, absY, w, h, zoom, panX, panY)
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const ur = unrotate(sx, sy, cx, cy, rotation)
  const mx = (x1 + x2) / 2
  const rotY = y1 - ROTATION_HIT_OFFSET
  return Math.abs(ur.sx - mx) < ROTATION_HIT_RADIUS && Math.abs(ur.sy - rotY) < ROTATION_HIT_RADIUS
}

interface UseDesignCanvasInputOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>
  hitTestSectionTitle: (cx: number, cy: number) => SceneNode | null
  hitTestComponentLabel: (cx: number, cy: number) => SceneNode | null
}

export function useDesignCanvasInput({
  canvasRef,
  hitTestSectionTitle,
  hitTestComponentLabel,
}: UseDesignCanvasInputOptions) {
  const dragRef = useRef<DragState | null>(null)
  const lastClickRef = useRef({ time: 0, x: 0, y: 0, count: 0 })

  const getCoords = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { sx: 0, sy: 0, cx: 0, cy: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const { x: cx, y: cy } = useDesignEditorStore.getState().screenToCanvas(sx, sy)
    return { sx, sy, cx, cy }
  }, [canvasRef])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    // Non-null alias for use in closures where TS can't narrow
    const canvas: HTMLCanvasElement = canvasEl

    const store = useDesignEditorStore.getState
    const refs = () => getEditorRefs()

    function applyResize(d: DragResize, cx: number, cy: number, constrain: boolean) {
      const { handle, origRect } = d
      let { x, y, width, height } = origRect
      const dx = cx - d.startX
      const dy = cy - d.startY

      if (handle.includes('e')) width = origRect.width + dx
      if (handle.includes('w')) { x = origRect.x + dx; width = origRect.width - dx }
      if (handle === 'sw' || handle === 's' || handle === 'se') height = origRect.height + dy
      if (handle === 'nw' || handle === 'n' || handle === 'ne') { y = origRect.y + dy; height = origRect.height - dy }

      if (constrain && origRect.width > 0 && origRect.height > 0) {
        const aspect = origRect.width / origRect.height
        if (handle === 'n' || handle === 's') {
          width = Math.abs(height) * aspect; x = origRect.x + (origRect.width - width) / 2
        } else if (handle === 'e' || handle === 'w') {
          height = Math.abs(width) / aspect; y = origRect.y + (origRect.height - height) / 2
        } else {
          if (Math.abs(dx) > Math.abs(dy)) {
            height = (Math.abs(width) / aspect) * Math.sign(height || 1)
            if (handle.startsWith('n')) y = origRect.y + origRect.height - Math.abs(height)
          } else {
            width = Math.abs(height) * aspect * Math.sign(width || 1)
            if (handle.includes('w')) x = origRect.x + origRect.width - Math.abs(width)
          }
        }
      }

      if (width < 0) { x += width; width = -width }
      if (height < 0) { y += height; height = -height }

      store().updateNode(d.nodeId, {
        x: Math.round(x), y: Math.round(y),
        width: Math.round(Math.max(1, width)), height: Math.round(Math.max(1, height)),
      })
    }

    function computeAutoLayoutIndicatorForFrame(parent: SceneNode, cx: number, cy: number) {
      const { graph } = refs()
      const s = store()
      const children = graph.getChildren(parent.id)
        .filter((c) => c.layoutPositioning !== 'ABSOLUTE' && !s.selectedIds.has(c.id))

      const parentAbs = graph.getAbsolutePosition(parent.id)
      const isRow = parent.layoutMode === 'HORIZONTAL'

      let insertIndex = children.length
      for (let i = 0; i < children.length; i++) {
        const childAbs = graph.getAbsolutePosition(children[i].id)
        const mid = isRow ? childAbs.x + children[i].width / 2 : childAbs.y + children[i].height / 2
        if ((isRow ? cx : cy) < mid) { insertIndex = i; break }
      }

      const crossStart = isRow ? parentAbs.y + parent.paddingTop : parentAbs.x + parent.paddingLeft
      const crossLength = isRow
        ? parent.height - parent.paddingTop - parent.paddingBottom
        : parent.width - parent.paddingLeft - parent.paddingRight

      let indicatorPos: number
      if (children.length === 0) {
        indicatorPos = isRow ? parentAbs.x + parent.paddingLeft : parentAbs.y + parent.paddingTop
      } else if (insertIndex === 0) {
        const firstAbs = graph.getAbsolutePosition(children[0].id)
        indicatorPos = isRow ? firstAbs.x - parent.itemSpacing / 2 : firstAbs.y - parent.itemSpacing / 2
      } else if (insertIndex >= children.length) {
        const last = children[children.length - 1]
        const lastAbs = graph.getAbsolutePosition(last.id)
        indicatorPos = isRow ? lastAbs.x + last.width + parent.itemSpacing / 2 : lastAbs.y + last.height + parent.itemSpacing / 2
      } else {
        const prev = children[insertIndex - 1]
        const next = children[insertIndex]
        const prevAbs = graph.getAbsolutePosition(prev.id)
        const nextAbs = graph.getAbsolutePosition(next.id)
        indicatorPos = isRow ? (prevAbs.x + prev.width + nextAbs.x) / 2 : (prevAbs.y + prev.height + nextAbs.y) / 2
      }

      // Convert filtered index to real childIds index
      const allChildren = graph.getChildren(parent.id)
      let realIndex = 0
      let filteredCount = 0
      for (let i = 0; i < allChildren.length; i++) {
        if (s.selectedIds.has(allChildren[i].id)) continue
        if (allChildren[i].layoutPositioning === 'ABSOLUTE') { realIndex++; continue }
        if (filteredCount === insertIndex) break
        filteredCount++
        realIndex++
      }

      s.setLayoutInsertIndicator({
        parentId: parent.id, index: realIndex,
        x: isRow ? indicatorPos : crossStart, y: isRow ? crossStart : indicatorPos,
        length: crossLength, direction: isRow ? 'VERTICAL' : 'HORIZONTAL',
      })
    }

    function onMouseDown(e: MouseEvent) {
      const s = store()
      s.setHoveredNode(null)
      const { sx, sy, cx, cy } = getCoords(e)

      // Multi-click tracking
      const lc = lastClickRef.current
      const now = performance.now()
      if (now - lc.time < 500 && Math.abs(sx - lc.x) < 5 && Math.abs(sy - lc.y) < 5) {
        lc.count++
      } else {
        lc.count = 1
      }
      lc.time = now; lc.x = sx; lc.y = sy

      const tool = s.activeTool
      const { graph, textEditor } = refs()

      // Pan: middle button or Hand tool
      if (e.button === 1 || tool === 'HAND') {
        dragRef.current = { type: 'pan', startScreenX: e.clientX, startScreenY: e.clientY, startPanX: s.panX, startPanY: s.panY }
        return
      }

      // Alt+click empty = pan
      if (tool === 'SELECT' && e.altKey && !s.selectedIds.size) {
        dragRef.current = { type: 'pan', startScreenX: e.clientX, startScreenY: e.clientY, startPanX: s.panX, startPanY: s.panY }
        return
      }

      if (tool === 'SELECT') {
        // Text editing mode
        if (s.editingTextId) {
          const editNode = graph.getNode(s.editingTextId)
          if (textEditor && editNode) {
            const abs = graph.getAbsolutePosition(editNode.id)
            const localX = cx - abs.x
            const localY = cy - abs.y
            if (localX >= 0 && localY >= 0 && localX <= editNode.width && localY <= editNode.height) {
              if (lc.count >= 3) textEditor.selectAll()
              else if (lc.count === 2) textEditor.selectWordAt(localX, localY)
              else {
                textEditor.setCursorAt(localX, localY, e.shiftKey)
                dragRef.current = { type: 'text-select', startX: cx, startY: cy }
              }
              s.requestRender()
              return
            }
          }
          s.commitTextEdit()
        }

        // Rotation handle (single selection)
        if (s.selectedIds.size === 1) {
          const id = [...s.selectedIds][0]
          const node = graph.getNode(id)
          if (node) {
            const abs = graph.getAbsolutePosition(id)
            if (hitTestRotationHandle(sx, sy, abs.x, abs.y, node.width, node.height, s.zoom, s.panX, s.panY, node.rotation)) {
              const screenCx = (abs.x + node.width / 2) * s.zoom + s.panX
              const screenCy = (abs.y + node.height / 2) * s.zoom + s.panY
              const startAngle = Math.atan2(sy - screenCy, sx - screenCx) * (180 / Math.PI)
              dragRef.current = { type: 'rotate', nodeId: id, centerX: screenCx, centerY: screenCy, startAngle, origRotation: node.rotation }
              return
            }
          }
        }

        // Resize handles
        for (const id of s.selectedIds) {
          const node = graph.getNode(id)
          if (!node) continue
          const abs = graph.getAbsolutePosition(id)
          const handle = hitTestHandle(sx, sy, abs.x, abs.y, node.width, node.height, s.zoom, s.panX, s.panY, node.rotation)
          if (handle) {
            dragRef.current = { type: 'resize', handle, startX: cx, startY: cy, origRect: { x: node.x, y: node.y, width: node.width, height: node.height }, nodeId: id }
            return
          }
        }

        // Hit test nodes
        const hit = hitTestSectionTitle(cx, cy) ?? hitTestComponentLabel(cx, cy) ?? graph.hitTest(cx, cy, s.currentPageId)
        if (hit) {
          if (!s.selectedIds.has(hit.id) && !e.shiftKey) s.select([hit.id])
          else if (e.shiftKey) s.select([hit.id], true)

          const originals = new Map<string, { x: number; y: number }>()
          for (const id of store().selectedIds) {
            const n = graph.getNode(id)
            if (n) originals.set(id, { x: n.x, y: n.y })
          }

          // Alt+drag = duplicate
          if (e.altKey && store().selectedIds.size > 0) {
            const newIds: string[] = []
            const newOriginals = new Map<string, { x: number; y: number }>()
            for (const id of store().selectedIds) {
              const src = graph.getNode(id)
              if (!src) continue
              const newId = store().createShape(src.type, src.x, src.y, src.width, src.height)
              graph.updateNode(newId, {
                name: src.name + ' copy', fills: [...src.fills], strokes: [...src.strokes],
                effects: [...src.effects], cornerRadius: src.cornerRadius, opacity: src.opacity, rotation: src.rotation,
              })
              newIds.push(newId)
              newOriginals.set(newId, { x: src.x, y: src.y })
            }
            store().select(newIds)
            dragRef.current = { type: 'move', startX: cx, startY: cy, originals: newOriginals, duplicated: true }
            store().requestRender()
            return
          }

          // Detect auto-layout parent
          let autoLayoutParentId: string | undefined
          if (store().selectedIds.size === 1) {
            const selectedId = [...store().selectedIds][0]
            const selectedNode = graph.getNode(selectedId)
            if (selectedNode?.parentId) {
              const parent = graph.getNode(selectedNode.parentId)
              if (parent && parent.layoutMode !== 'NONE' && selectedNode.layoutPositioning !== 'ABSOLUTE') {
                autoLayoutParentId = parent.id
              }
            }
          }

          dragRef.current = { type: 'move', startX: cx, startY: cy, originals, autoLayoutParentId }
        } else {
          s.clearSelection()
          dragRef.current = { type: 'marquee', startX: cx, startY: cy }
        }
        return
      }

      // Pen tool
      if (tool === 'PEN') {
        s.penAddVertex(cx, cy)
        dragRef.current = { type: 'pen-drag', startX: cx, startY: cy }
        return
      }

      // Text tool
      if (tool === 'TEXT') {
        const nodeId = s.createShape('TEXT', cx, cy, DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT)
        graph.updateNode(nodeId, { text: '' })
        s.select([nodeId])
        s.startTextEditing(nodeId)
        s.setTool('SELECT')
        s.requestRender()
        return
      }

      // Shape creation
      const nodeType = TOOL_TO_NODE[tool]
      if (!nodeType) return
      const nodeId = s.createShape(nodeType, cx, cy, 0, 0)
      s.select([nodeId])
      dragRef.current = { type: 'draw', startX: cx, startY: cy, nodeId }
    }

    function onMouseMove(e: MouseEvent) {
      const s = store()
      const { graph, textEditor } = refs()

      // Pen cursor preview
      if (s.activeTool === 'PEN' && s.penState && !dragRef.current) {
        const { cx, cy } = getCoords(e)
        const first = s.penState.vertices[0]
        if (s.penState.vertices.length > 2 && first) {
          const dist = Math.hypot(cx - first.x, cy - first.y)
          s.penSetClosingToFirst(dist < PEN_CLOSE_THRESHOLD)
        }
        // Direct mutation + repaint (matches open-pencil pattern for cursor tracking)
        useDesignEditorStore.setState({ penCursorX: cx, penCursorY: cy })
        s.requestRepaint()
      }

      // Hover highlight
      if (!dragRef.current && s.activeTool === 'SELECT') {
        const { sx, sy, cx, cy } = getCoords(e)
        let cursor: string | null = null

        if (s.selectedIds.size === 1) {
          const id = [...s.selectedIds][0]
          const node = graph.getNode(id)
          if (node) {
            const abs = graph.getAbsolutePosition(id)
            if (hitTestRotationHandle(sx, sy, abs.x, abs.y, node.width, node.height, s.zoom, s.panX, s.panY, node.rotation)) {
              cursor = 'grab'
            }
          }
        }

        if (!cursor) {
          for (const id of s.selectedIds) {
            const node = graph.getNode(id)
            if (!node) continue
            const abs = graph.getAbsolutePosition(id)
            const handle = hitTestHandle(sx, sy, abs.x, abs.y, node.width, node.height, s.zoom, s.panX, s.panY, node.rotation)
            if (handle) { cursor = HANDLE_CURSORS[handle]; break }
          }
        }
        canvas.style.cursor = cursor ?? ''

        const hit = hitTestSectionTitle(cx, cy) ?? hitTestComponentLabel(cx, cy) ?? graph.hitTest(cx, cy, s.currentPageId)
        s.setHoveredNode(hit && !s.selectedIds.has(hit.id) ? hit.id : null)
      }

      if (!dragRef.current) return
      const d = dragRef.current

      if (d.type === 'pan') {
        useDesignEditorStore.setState({
          panX: d.startPanX + (e.clientX - d.startScreenX),
          panY: d.startPanY + (e.clientY - d.startScreenY),
        })
        store().requestRepaint()
        return
      }

      const { cx, cy, sx, sy } = getCoords(e)

      if (d.type === 'rotate') {
        const currentAngle = Math.atan2(sy - d.centerY, sx - d.centerX) * (180 / Math.PI)
        let rotation = d.origRotation + (currentAngle - d.startAngle)
        if (e.shiftKey) rotation = Math.round(rotation / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
        rotation = ((((rotation + 180) % 360) + 360) % 360) - 180
        s.setRotationPreview({ nodeId: d.nodeId, angle: rotation })
        return
      }

      if (d.type === 'move') {
        let dx = cx - d.startX
        let dy = cy - d.startY

        // Auto-layout dead zone
        if (d.autoLayoutParentId && !d.brokeFromAutoLayout) {
          if (Math.sqrt(dx * dx + dy * dy) < AUTO_LAYOUT_BREAK_THRESHOLD) {
            const parent = graph.getNode(d.autoLayoutParentId)
            if (parent && parent.layoutMode !== 'NONE') computeAutoLayoutIndicatorForFrame(parent, cx, cy)
            return
          }
          d.brokeFromAutoLayout = true
          s.setLayoutInsertIndicator(null)
        }

        // Drop target detection
        let dropTarget = graph.hitTestFrame(cx, cy, s.selectedIds, s.currentPageId)
        const movingSection = [...s.selectedIds].some((id) => graph.getNode(id)?.type === 'SECTION')
        if (movingSection && dropTarget && dropTarget.type !== 'SECTION' && dropTarget.type !== 'CANVAS') {
          dropTarget = null
        }
        const dropParent = dropTarget ? graph.getNode(dropTarget.id) : null

        if (dropParent && dropParent.layoutMode !== 'NONE') {
          computeAutoLayoutIndicatorForFrame(dropParent, cx, cy)
          s.setDropTarget(dropParent.id)
          for (const [id, orig] of d.originals) {
            graph.updateNode(id, { x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) })
          }
          store().requestRender()
          return
        }

        s.setLayoutInsertIndicator(null)

        // Snap computation
        const selectedNodes: SceneNode[] = []
        for (const [id, orig] of d.originals) {
          const n = graph.getNode(id)
          if (n) {
            const abs = graph.getAbsolutePosition(id)
            const parentAbs = n.parentId ? graph.getAbsolutePosition(n.parentId) : { x: 0, y: 0 }
            selectedNodes.push({ ...n, x: abs.x - parentAbs.x - n.x + orig.x + dx, y: abs.y - parentAbs.y - n.y + orig.y + dy })
          }
        }

        const bounds = computeSelectionBounds(selectedNodes)
        if (bounds) {
          const firstId = [...d.originals.keys()][0]
          const firstNode = graph.getNode(firstId)
          const parentId = firstNode?.parentId ?? s.currentPageId
          const siblings = graph.getChildren(parentId)
          const parentAbs = !store().isTopLevel(parentId) ? graph.getAbsolutePosition(parentId) : { x: 0, y: 0 }
          const absTargets = siblings.map((n) => ({ ...n, x: n.x + parentAbs.x, y: n.y + parentAbs.y }))
          const absBounds = { x: bounds.x + parentAbs.x, y: bounds.y + parentAbs.y, width: bounds.width, height: bounds.height }
          const snap = computeSnap(s.selectedIds, absBounds, absTargets)
          dx += snap.dx; dy += snap.dy
          s.setSnapGuides(snap.guides)
        }

        for (const [id, orig] of d.originals) {
          store().updateNode(id, { x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) })
        }
        s.setDropTarget(dropTarget?.id ?? null)
        return
      }

      if (d.type === 'text-select') {
        const editNode = s.editingTextId ? graph.getNode(s.editingTextId) : null
        if (textEditor && editNode) {
          const abs = graph.getAbsolutePosition(editNode.id)
          textEditor.setCursorAt(cx - abs.x, cy - abs.y, true)
          s.requestRender()
        }
        return
      }

      if (d.type === 'resize') { applyResize(d, cx, cy, e.shiftKey); return }

      if (d.type === 'pen-drag') {
        const tx = cx - d.startX
        const ty = cy - d.startY
        if (Math.hypot(tx, ty) > 2) s.penSetDragTangent(tx, ty)
        return
      }

      if (d.type === 'draw') {
        let w = cx - d.startX
        let h = cy - d.startY
        if (e.shiftKey) { const size = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w) * size; h = Math.sign(h) * size }
        store().updateNode(d.nodeId, {
          x: w < 0 ? d.startX + w : d.startX, y: h < 0 ? d.startY + h : d.startY,
          width: Math.abs(w), height: Math.abs(h),
        })
        return
      }

      if (d.type === 'marquee') {
        const minX = Math.min(d.startX, cx); const minY = Math.min(d.startY, cy)
        const maxX = Math.max(d.startX, cx); const maxY = Math.max(d.startY, cy)
        const hits: string[] = []
        for (const node of graph.getChildren(s.currentPageId)) {
          if (node.x + node.width > minX && node.x < maxX && node.y + node.height > minY && node.y < maxY) {
            hits.push(node.id)
          }
        }
        s.select(hits)
        s.setMarquee({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
      }
    }

    function onMouseUp() {
      if (!dragRef.current) return
      const d = dragRef.current
      const s = store()
      const { graph } = refs()

      if (d.type === 'move') {
        const indicator = s.layoutInsertIndicator
        s.setLayoutInsertIndicator(null)
        s.setSnapGuides([])

        if (indicator) {
          for (const id of s.selectedIds) {
            s.reorderInAutoLayout(id, indicator.parentId, indicator.index)
          }
          s.setDropTarget(null)
        } else {
          const moved = [...d.originals].some(([id, orig]) => {
            const node = graph.getNode(id)
            return node && (node.x !== orig.x || node.y !== orig.y)
          })
          if (moved) {
            s.commitMove(d.originals)
            const dropId = s.dropTargetId
            if (dropId) {
              s.reparentNodes([...s.selectedIds], dropId)
            } else {
              for (const id of s.selectedIds) {
                const node = graph.getNode(id)
                if (!node?.parentId || s.isTopLevel(node.parentId)) continue
                const parent = graph.getNode(node.parentId)
                if (!parent || (parent.type !== 'FRAME' && parent.type !== 'SECTION')) continue
                if (node.x + node.width < 0 || node.x > parent.width || node.y + node.height < 0 || node.y > parent.height) {
                  const grandparentId = parent.parentId ?? s.currentPageId
                  graph.reparentNode(id, grandparentId)
                }
              }
            }
          }
          s.setDropTarget(null)
        }
      }

      if (d.type === 'text-select') { dragRef.current = null; return }

      if (d.type === 'resize') s.commitResize(d.nodeId, d.origRect)

      if (d.type === 'pen-drag') { dragRef.current = null; return }

      if (d.type === 'rotate') {
        const preview = s.rotationPreview
        if (preview) {
          s.updateNode(d.nodeId, { rotation: preview.angle })
          s.commitRotation(d.nodeId, d.origRotation)
        }
        s.setRotationPreview(null)
      }

      if (d.type === 'draw') {
        const node = graph.getNode(d.nodeId)
        if (node && node.width < 2 && node.height < 2) {
          s.updateNode(d.nodeId, { width: 100, height: 100 })
        }
        if (node?.type === 'SECTION') s.adoptNodesIntoSection(node.id)
        s.setTool('SELECT')
      }

      if (d.type === 'marquee') s.setMarquee(null)

      dragRef.current = null
      canvas.style.cursor = ''
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const s = store()
      const rect = canvas.getBoundingClientRect()
      // Scroll wheel always zooms; hold Shift to pan instead
      if (e.shiftKey) {
        s.pan(-e.deltaX, -e.deltaY)
      } else {
        s.applyZoom(-e.deltaY, e.clientX - rect.left, e.clientY - rect.top)
      }
    }

    function onDblClick(e: MouseEvent) {
      const s = store()
      if (s.editingTextId) return
      const { cx, cy } = getCoords(e)
      const { graph, textEditor } = refs()
      const hit = hitTestSectionTitle(cx, cy) ?? hitTestComponentLabel(cx, cy) ?? graph.hitTestDeep(cx, cy, s.currentPageId)
      if (!hit) return

      if (hit.type === 'TEXT') {
        s.select([hit.id])
        s.startTextEditing(hit.id)
        if (textEditor) {
          const abs = graph.getAbsolutePosition(hit.id)
          textEditor.selectWordAt(cx - abs.x, cy - abs.y)
          s.requestRender()
        }
        return
      }
      s.select([hit.id])
    }

    // Touch support
    let activeTouches: Touch[] = []
    let pinchStartDist = 0
    let pinchStartZoom = 0
    let pinchMidX = 0
    let pinchMidY = 0
    const isTouchDevice = matchMedia('(pointer: coarse)').matches

    function onTouchStart(e: TouchEvent) {
      if (!isTouchDevice) return
      e.preventDefault()
      activeTouches = Array.from(e.touches)
      if (activeTouches.length === 2) {
        dragRef.current = null
        const [a, b] = activeTouches
        pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        pinchStartZoom = store().zoom
        const rect = canvas.getBoundingClientRect()
        pinchMidX = (a.clientX + b.clientX) / 2 - rect.left
        pinchMidY = (a.clientY + b.clientY) / 2 - rect.top
      } else if (activeTouches.length === 1) {
        const t = activeTouches[0]
        dragRef.current = { type: 'pan', startScreenX: t.clientX, startScreenY: t.clientY, startPanX: store().panX, startPanY: store().panY }
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!isTouchDevice) return
      e.preventDefault()
      activeTouches = Array.from(e.touches)
      const s = store()

      if (activeTouches.length === 2) {
        const [a, b] = activeTouches
        const rect = canvas.getBoundingClientRect()
        const newMidX = (a.clientX + b.clientX) / 2 - rect.left
        const newMidY = (a.clientY + b.clientY) / 2 - rect.top
        const newDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

        if (pinchStartDist > 0) {
          const newZoom = Math.max(0.02, Math.min(256, pinchStartZoom * (newDist / pinchStartDist)))
          const zoomRatio = newZoom / s.zoom
          useDesignEditorStore.setState({
            panX: pinchMidX - (pinchMidX - s.panX) * zoomRatio + (newMidX - pinchMidX),
            panY: pinchMidY - (pinchMidY - s.panY) * zoomRatio + (newMidY - pinchMidY),
            zoom: newZoom,
          })
        }
        pinchMidX = newMidX; pinchMidY = newMidY
        s.requestRepaint()
      } else if (activeTouches.length === 1 && dragRef.current?.type === 'pan') {
        const t = activeTouches[0]
        const d = dragRef.current
        useDesignEditorStore.setState({
          panX: d.startPanX + (t.clientX - d.startScreenX),
          panY: d.startPanY + (t.clientY - d.startScreenY),
        })
        s.requestRepaint()
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!isTouchDevice) return
      e.preventDefault()
      activeTouches = Array.from(e.touches)
      if (activeTouches.length === 0) {
        dragRef.current = null; pinchStartDist = 0
      } else if (activeTouches.length === 1) {
        const t = activeTouches[0]
        dragRef.current = { type: 'pan', startScreenX: t.clientX, startScreenY: t.clientY, startPanX: store().panX, startPanY: store().panY }
        pinchStartDist = 0
      }
    }

    // Safari macOS gesture events
    let gestureStartZoom = 1
    function onGestureStart(e: Event) { e.preventDefault(); gestureStartZoom = store().zoom }
    function onGestureChange(e: Event) {
      e.preventDefault()
      const ge = e as Event & { scale: number; clientX?: number; clientY?: number }
      const rect = canvas.getBoundingClientRect()
      const sx = (ge.clientX ?? rect.width / 2) - rect.left
      const sy = (ge.clientY ?? rect.height / 2) - rect.top
      const s = store()
      const newZoom = Math.max(0.02, Math.min(256, gestureStartZoom * ge.scale))
      const zoomRatio = newZoom / s.zoom
      useDesignEditorStore.setState({
        panX: sx - (sx - s.panX) * zoomRatio,
        panY: sy - (sy - s.panY) * zoomRatio,
        zoom: newZoom,
      })
      s.requestRepaint()
    }
    function onGestureEnd(e: Event) { e.preventDefault() }

    function onMouseLeave() {
      // Don't terminate drag operations when mouse leaves canvas
      // They will end on mouseup (caught by window listener)
      if (dragRef.current) return
      store().setSnapGuides([])
      store().setHoveredNode(null)
    }

    // Track window-level mouseup listener for cleanup
    let windowMouseUpCleanup: (() => void) | null = null

    function onMouseDownWithWindowCapture(e: MouseEvent) {
      onMouseDown(e)
      // If a drag was started, add window-level listeners so drag continues outside canvas
      if (dragRef.current) {
        const onWindowMouseMove = (ev: MouseEvent) => { onMouseMove(ev) }
        const onWindowMouseUp = () => {
          onMouseUp()
          window.removeEventListener('mousemove', onWindowMouseMove)
          windowMouseUpCleanup = null
        }
        window.addEventListener('mousemove', onWindowMouseMove)
        window.addEventListener('mouseup', onWindowMouseUp, { once: true })
        windowMouseUpCleanup = () => {
          window.removeEventListener('mousemove', onWindowMouseMove)
          window.removeEventListener('mouseup', onWindowMouseUp)
        }
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      useDesignEditorStore.getState().setContextMenu({ x: e.clientX, y: e.clientY })
    }
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('mousedown', onMouseDownWithWindowCapture)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false })
    canvas.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions)
    canvas.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions)
    canvas.addEventListener('gestureend', onGestureEnd, { passive: false } as AddEventListenerOptions)

    return () => {
      windowMouseUpCleanup?.()
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('mousedown', onMouseDownWithWindowCapture)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
      canvas.removeEventListener('gestureend', onGestureEnd)
    }
  }, [canvasRef, getCoords, hitTestSectionTitle, hitTestComponentLabel])
}
