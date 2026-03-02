/**
 * LayersPanel Component
 *
 * Tree view of SceneGraph nodes for the design editor.
 * Click to select, shift+click for additive selection.
 * Expand/collapse for container nodes. Shows type icon and visibility.
 *
 * Ported from open-pencil's LayersPanel.vue.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDesignEditorStore } from '@/stores/designEditorStore'
import { getEditorRefs } from '@/stores/designEditorRefs'

interface LayerItem {
  id: string
  name: string
  type: string
  visible: boolean
  depth: number
  hasChildren: boolean
}

const TYPE_LABELS: Record<string, string> = {
  FRAME: 'F', RECTANGLE: 'R', ELLIPSE: 'E', TEXT: 'T', LINE: 'L',
  VECTOR: 'V', GROUP: 'G', SECTION: 'S', COMPONENT: 'C',
  COMPONENT_SET: 'CS', INSTANCE: 'I', STAR: '*', POLYGON: 'P',
}

interface LayersPanelProps {
  onClose?: () => void
}

export const LayersPanel: React.FC<LayersPanelProps> = ({ onClose }) => {
  const { selectedIds, sceneVersion, currentPageId } = useDesignEditorStore(
    useShallow((s) => ({
      selectedIds: s.selectedIds,
      sceneVersion: s.sceneVersion,
      currentPageId: s.currentPageId,
    }))
  )

  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const layers = useMemo(() => {
    // Re-derive when sceneVersion changes
    void sceneVersion
    const { graph } = getEditorRefs()
    const result: LayerItem[] = []

    function walk(parentId: string, depth: number) {
      const parent = graph.getNode(parentId)
      if (!parent) return
      // Reverse order so top layers appear first (like Figma)
      const childIds = [...parent.childIds].reverse()
      for (const childId of childIds) {
        const node = graph.getNode(childId)
        if (!node) continue
        const hasChildren = node.childIds.length > 0
        result.push({
          id: node.id,
          name: node.name,
          type: node.type,
          visible: node.visible,
          depth,
          hasChildren,
        })
        if (hasChildren && expanded.has(node.id)) {
          walk(node.id, depth + 1)
        }
      }
    }

    walk(currentPageId, 0)
    return result
  }, [sceneVersion, currentPageId, expanded])

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    useDesignEditorStore.getState().select([id], e.shiftKey)
  }, [])

  const toggleVisibility = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const { graph } = getEditorRefs()
    const node = graph.getNode(id)
    if (!node) return
    useDesignEditorStore.getState().updateNodeWithUndo(id, { visible: !node.visible }, 'Toggle visibility')
  }, [])

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
        <span className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">Layers</span>
        {onClose && (
          <button onClick={onClose} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Close layers">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l6 6M10 4l-6 6" /></svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {layers.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            No layers
          </div>
        )}
        {layers.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={(e) => handleClick(item.id, e)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(item.id, e as unknown as React.MouseEvent) } }}
            className={`group flex w-full items-center gap-1 rounded py-1 text-left text-xs cursor-pointer ${
              selectedIds.has(item.id)
                ? 'bg-blue-500 text-white'
                : 'bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            } ${!item.visible ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${8 + item.depth * 16}px` }}
          >
            {/* Expand toggle */}
            {item.hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(item.id) }}
                className={`flex w-4 shrink-0 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-transform ${
                  expanded.has(item.id) ? 'rotate-90' : ''
                }`}
                aria-label={expanded.has(item.id) ? 'Collapse' : 'Expand'}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            {/* Type indicator */}
            <span className={`text-[10px] font-mono w-4 shrink-0 text-center ${
              ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(item.type)
                ? 'text-purple-500'
                : selectedIds.has(item.id) ? 'text-white/70' : 'text-gray-400'
            }`}>
              {TYPE_LABELS[item.type] ?? '?'}
            </span>

            {/* Name */}
            <span className="min-w-0 flex-1 truncate">{item.name}</span>

            {/* Visibility toggle - always shown when hidden, shown on hover when visible */}
            <button
              onClick={(e) => toggleVisibility(item.id, e)}
              className={`mr-1 shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ${
                item.visible ? 'opacity-0 group-hover:opacity-100' : ''
              }`}
              aria-label={item.visible ? 'Hide' : 'Show'}
            >
              {item.visible ? (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default LayersPanel
