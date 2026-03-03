/**
 * useDesignKeyboard Hook
 *
 * Handles keyboard shortcuts for the design editor.
 * Ported from open-pencil's use-keyboard.ts (Vue composable -> React hook).
 */

import { useEffect } from 'react'
import { useDesignEditorStore, type Tool } from '@/stores/designEditorStore'

const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'SELECT',
  r: 'RECTANGLE',
  f: 'FRAME',
  o: 'ELLIPSE',
  l: 'LINE',
  t: 'TEXT',
  p: 'PEN',
  h: 'HAND',
  s: 'SECTION',
}

function isEditing(e: Event): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
}

export function useDesignKeyboard() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditing(e)) return

      const store = useDesignEditorStore.getState()

      // Tool shortcuts (single key, no modifiers)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()]
        if (tool) {
          store.setTool(tool)
          return
        }
      }

      // Cmd/Ctrl shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          store.undoAction()
          return
        }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault()
          store.redoAction()
          return
        }
        if (e.key === 'd') {
          e.preventDefault()
          store.duplicateSelected()
          return
        }
        if (e.key === 'a') {
          e.preventDefault()
          store.selectAll()
          return
        }
        if (e.key === 'g' && !e.shiftKey) {
          e.preventDefault()
          store.groupSelected()
          return
        }
        if (e.key === 'g' && e.shiftKey) {
          e.preventDefault()
          store.ungroupSelected()
          return
        }
      }

      // Shift+1: zoom to fit all
      if (e.shiftKey && e.key === '!') {
        e.preventDefault()
        store.zoomToFit(window.innerWidth, window.innerHeight)
        return
      }

      // Shift+2: zoom to selection
      if (e.shiftKey && e.key === '@') {
        e.preventDefault()
        store.zoomToSelection(window.innerWidth, window.innerHeight)
        return
      }

      // Shift+A: toggle auto-layout
      if (e.shiftKey && e.key === 'A') {
        e.preventDefault()
        const node = store.getSelectedNode()
        if (node && node.type === 'FRAME' && store.getSelectedNodes().length === 1) {
          store.setLayoutMode(node.id, node.layoutMode === 'NONE' ? 'VERTICAL' : 'NONE')
        }
        return
      }

      // Bring to front / send to back
      if (e.key === ']') { e.preventDefault(); store.bringToFront(); return }
      if (e.key === '[') { e.preventDefault(); store.sendToBack(); return }

      // Delete
      if (e.key === 'Backspace' || e.key === 'Delete') {
        store.deleteSelected()
        return
      }

      // Enter: commit pen path
      if (e.key === 'Enter' && store.penState) {
        e.preventDefault()
        store.penCommit(false)
        return
      }

      // Escape
      if (e.key === 'Escape') {
        if (store.contextMenu) { store.setContextMenu(null); return }
        if (store.penState) { store.penCancel(); return }
        if (store.editingTextId) { store.commitTextEdit(); return }
        store.clearSelection()
        store.setTool('SELECT')
        return
      }

      // Arrow key nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (store.selectedIds.size === 0) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const nodes = store.getSelectedNodes()
        const originals = new Map<string, { x: number; y: number }>()
        for (const node of nodes) {
          originals.set(node.id, { x: node.x, y: node.y })
          store.updateNode(node.id, { x: node.x + dx, y: node.y + dy })
        }
        store.commitMove(originals)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
