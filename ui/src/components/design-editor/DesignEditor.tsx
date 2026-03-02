/**
 * DesignEditor Component
 *
 * Top-level wrapper that composes the design editor toolbar, canvas,
 * input handling, keyboard shortcuts, and data sync.
 */

import React, { useRef, useEffect, useState } from 'react'
import { DesignToolbar } from './DesignToolbar'
import { LayersPanel } from './LayersPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { useDesignCanvas } from '@/hooks/useDesignCanvas'
import { useDesignCanvasInput } from '@/hooks/useDesignCanvasInput'
import { useDesignKeyboard } from '@/hooks/useDesignKeyboard'
import { useDesignTextEdit } from '@/hooks/useDesignTextEdit'
import { useDesignSync } from '@/hooks/useDesignSync'
import { useSessionStore } from '@/stores/sessionStore'

interface DesignEditorProps {
  designId: string | null
}

export const DesignEditor: React.FC<DesignEditorProps> = ({ designId }) => {
  const {
    canvasRef,
    isLoading,
    error,
    hitTestSectionTitle,
    hitTestComponentLabel,
  } = useDesignCanvas()

  useDesignCanvasInput({
    canvasRef,
    hitTestSectionTitle,
    hitTestComponentLabel,
  })

  useDesignKeyboard()
  useDesignTextEdit(canvasRef)
  const { handleRemoteUpdate } = useDesignSync(designId)

  // Watch for remote updates via session store (WebSocket -> App.tsx -> sessionStore)
  const designContent = useSessionStore((s) => {
    const design = s.designs.find(d => d.id === designId)
    return design?.content
  })
  const lastRemoteContentRef = useRef(designContent)
  useEffect(() => {
    if (designContent && designContent !== lastRemoteContentRef.current) {
      // Only apply if this looks like a remote update (not our own save)
      lastRemoteContentRef.current = designContent
      handleRemoteUpdate(designContent)
    }
  }, [designContent, handleRemoteUpdate])

  const [showLayers, setShowLayers] = useState(false)
  const [showProperties, setShowProperties] = useState(false)

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md px-4">
          <p className="text-red-600 dark:text-red-400 font-medium mb-2">
            Canvas initialization failed
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <DesignToolbar />
      <div className="flex-1 min-h-0 flex">
        {/* Left: Layers panel */}
        {showLayers && (
          <div className="w-[240px] shrink-0 border-r border-gray-200 dark:border-gray-700">
            <LayersPanel onClose={() => setShowLayers(false)} />
          </div>
        )}

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0 relative overflow-hidden bg-gray-100 dark:bg-gray-800">
          {/* Panel toggle buttons */}
          {!showLayers && (
            <button
              onClick={() => setShowLayers(true)}
              className="absolute top-2 left-2 z-20 p-1.5 rounded bg-white dark:bg-gray-700 shadow border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
              title="Show layers"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
            </button>
          )}
          {!showProperties && (
            <button
              onClick={() => setShowProperties(true)}
              className="absolute top-2 right-2 z-20 p-1.5 rounded bg-white dark:bg-gray-700 shadow border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
              title="Show properties"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 2v12M8 4v8M12 6v4" />
              </svg>
            </button>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-100 dark:bg-gray-800">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Loading design editor...
                </p>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            data-testid="design-editor-canvas"
          />
        </div>

        {/* Right: Properties panel */}
        {showProperties && (
          <div className="w-[256px] shrink-0 border-l border-gray-200 dark:border-gray-700">
            <PropertiesPanel onClose={() => setShowProperties(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

export default DesignEditor
