/**
 * DesignToolbar Component
 *
 * Horizontal toolbar above the design editor canvas with tool selection,
 * zoom controls, and undo/redo buttons.
 */

import React, { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDesignEditorStore, type Tool } from '@/stores/designEditorStore'
import { getEditorRefs } from '@/stores/designEditorRefs'
import { renderNodesToImage } from '@/engine/render-image'

interface ToolButton {
  tool: Tool
  label: string
  shortcut: string
}

const TOOLS: ToolButton[] = [
  { tool: 'SELECT', label: 'Select', shortcut: 'V' },
  { tool: 'FRAME', label: 'Frame', shortcut: 'F' },
  { tool: 'RECTANGLE', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ELLIPSE', label: 'Ellipse', shortcut: 'O' },
  { tool: 'LINE', label: 'Line', shortcut: 'L' },
  { tool: 'TEXT', label: 'Text', shortcut: 'T' },
  { tool: 'PEN', label: 'Pen', shortcut: 'P' },
  { tool: 'HAND', label: 'Hand', shortcut: 'H' },
]

export const DesignToolbar: React.FC = () => {
  const { activeTool, sceneVersion, setTool } = useDesignEditorStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      sceneVersion: s.sceneVersion,
      setTool: s.setTool,
    }))
  )

  const handleUndo = () => useDesignEditorStore.getState().undoAction()
  const handleRedo = () => useDesignEditorStore.getState().redoAction()

  // Re-evaluate on sceneVersion changes so buttons update after edits/undo/redo
  void sceneVersion
  const canUndo = getEditorRefs().undo.canUndo
  const canRedo = getEditorRefs().undo.canRedo

  const handleExportPng = useCallback(() => {
    const { canvasKit, renderer, graph } = getEditorRefs()
    if (!canvasKit || !renderer) return
    const pageId = useDesignEditorStore.getState().currentPageId
    const page = graph.getNode(pageId)
    if (!page || page.childIds.length === 0) return

    const data = renderNodesToImage(canvasKit, renderer, graph, pageId, page.childIds, {
      scale: 2,
      format: 'PNG',
    })
    if (!data) return

    const blob = new Blob([new Uint8Array(data)], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'design.png'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleCopyPng = useCallback(async () => {
    const { canvasKit, renderer, graph } = getEditorRefs()
    if (!canvasKit || !renderer) return
    const pageId = useDesignEditorStore.getState().currentPageId
    const page = graph.getNode(pageId)
    if (!page || page.childIds.length === 0) return

    const data = renderNodesToImage(canvasKit, renderer, graph, pageId, page.childIds, {
      scale: 2,
      format: 'PNG',
    })
    if (!data) return

    const blob = new Blob([new Uint8Array(data)], { type: 'image/png' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, [])

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 select-none">
      {/* Tool buttons */}
      <div className="flex items-center gap-0.5 mr-2">
        {TOOLS.map(({ tool, label, shortcut }) => (
          <button
            key={tool}
            onClick={() => setTool(tool)}
            title={`${label} (${shortcut})`}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              activeTool === tool
                ? 'bg-info-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

      {/* Undo/Redo */}
      <button
        onClick={handleUndo}
        disabled={!canUndo}
        title="Undo (Cmd+Z)"
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Undo
      </button>
      <button
        onClick={handleRedo}
        disabled={!canRedo}
        title="Redo (Cmd+Shift+Z)"
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Redo
      </button>

      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

      {/* Export */}
      <button
        onClick={handleExportPng}
        title="Export PNG"
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
      >
        Export
      </button>
      <button
        onClick={handleCopyPng}
        title="Copy to clipboard"
        className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
      >
        Copy
      </button>

      <div className="flex-1" />

      <NavHelpButton />
    </div>
  )
}

function NavHelpButton() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="px-1.5 py-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded">
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-3 w-56 text-xs text-gray-600 dark:text-gray-300 space-y-1.5">
          <div className="font-medium text-gray-700 dark:text-gray-200 mb-2">Navigation</div>
          <div className="flex justify-between"><span>Pan</span><span className="text-gray-400">Middle-drag or Alt+drag</span></div>
          <div className="flex justify-between"><span>Pan</span><span className="text-gray-400">Shift+scroll</span></div>
          <div className="flex justify-between"><span>Zoom</span><span className="text-gray-400">Scroll wheel</span></div>
          <div className="flex justify-between"><span>Zoom to fit</span><span className="text-gray-400">Shift+1</span></div>
        </div>
      )}
    </div>
  )
}

export default DesignToolbar
