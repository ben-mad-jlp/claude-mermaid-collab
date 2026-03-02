/**
 * useDesignCanvas Hook
 *
 * Initializes CanvasKit WASM, creates a WebGL surface, and drives
 * RAF-batched rendering via the SkiaRenderer. Also handles canvas
 * resize via ResizeObserver.
 *
 * Ported from open-pencil's use-canvas.ts (Vue composable -> React hook).
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { getCanvasKit } from '@/engine/canvaskit'
import { SkiaRenderer } from '@/engine/renderer'
import type { SceneNode } from '@/engine/scene-graph'
import { initEditorRefs, destroyEditorRefs, getEditorRefs } from '@/stores/designEditorRefs'
import { useDesignEditorStore } from '@/stores/designEditorStore'

export interface UseDesignCanvasReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>
  isLoading: boolean
  error: string | null
  hitTestSectionTitle: (canvasX: number, canvasY: number) => SceneNode | null
  hitTestComponentLabel: (canvasX: number, canvasY: number) => SceneNode | null
}

export function useDesignCanvas(): UseDesignCanvasReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const rendererRef = useRef<SkiaRenderer | null>(null)
  const rafIdRef = useRef(0)
  const resizeRafRef = useRef(0)
  const destroyedRef = useRef(false)

  // Subscribe to versions that trigger re-render
  const renderVersion = useDesignEditorStore((s) => s.renderVersion)
  const selectedIds = useDesignEditorStore((s) => s.selectedIds)

  const renderNow = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const canvas = canvasRef.current
    if (!canvas) return

    const state = useDesignEditorStore.getState()
    const { graph, textEditor } = getEditorRefs()

    renderer.dpr = window.devicePixelRatio || 1
    renderer.panX = state.panX
    renderer.panY = state.panY
    renderer.zoom = state.zoom
    renderer.viewportWidth = canvas.clientWidth
    renderer.viewportHeight = canvas.clientHeight
    renderer.showRulers = true
    renderer.pageColor = state.pageColor
    renderer.pageId = state.currentPageId

    renderer.render(
      graph,
      state.selectedIds,
      {
        hoveredNodeId: state.hoveredNodeId,
        editingTextId: state.editingTextId,
        textEditor,
        marquee: state.marquee,
        snapGuides: state.snapGuides,
        rotationPreview: state.rotationPreview,
        dropTargetId: state.dropTargetId,
        layoutInsertIndicator: state.layoutInsertIndicator,
        penState: state.penState
          ? {
              ...state.penState,
              cursorX: state.penCursorX ?? undefined,
              cursorY: state.penCursorY ?? undefined,
            }
          : null,
        remoteCursors:
          state.remoteCursors.length > 0 ? state.remoteCursors : undefined,
      },
      state.sceneVersion
    )
  }, [])

  const scheduleRender = useCallback(() => {
    if (rafIdRef.current) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0
      renderNow()
    })
  }, [renderNow])

  // Trigger render when renderVersion or selectedIds change
  useEffect(() => {
    scheduleRender()
  }, [renderVersion, selectedIds, scheduleRender])

  // Init: load CanvasKit WASM, create surface
  useEffect(() => {
    destroyedRef.current = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas || destroyedRef.current) return

      try {
        const ck = await getCanvasKit()
        if (destroyedRef.current) return

        // Wait one frame for layout to settle
        await new Promise((r) => requestAnimationFrame(r))
        if (destroyedRef.current) return

        const dpr = window.devicePixelRatio || 1
        const w = canvas.clientWidth
        const h = canvas.clientHeight
        canvas.width = w * dpr
        canvas.height = h * dpr

        const surface = ck.MakeWebGLCanvasSurface(canvas)
        if (!surface) {
          setError('Failed to create WebGL surface. Your browser may not support WebGL.')
          setIsLoading(false)
          return
        }

        const renderer = new SkiaRenderer(ck, surface)
        rendererRef.current = renderer
        initEditorRefs(ck, renderer)

        renderer.loadFonts().then(() => renderNow())
        renderNow()

        canvas.dataset.ready = '1'
        setIsLoading(false)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to initialize CanvasKit'
        )
        setIsLoading(false)
      }
    }

    init()

    return () => {
      destroyedRef.current = true
      cancelAnimationFrame(rafIdRef.current)
      cancelAnimationFrame(resizeRafRef.current)
      rendererRef.current = null
      destroyEditorRefs()
    }
  }, [renderNow])

  // ResizeObserver for canvas resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(() => {
      if (!rendererRef.current || resizeRafRef.current) return
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0
        const c = canvasRef.current
        if (!c) return

        const { canvasKit } = getEditorRefs()
        if (!canvasKit) return

        // Recreate surface at new size
        rendererRef.current?.destroy()
        rendererRef.current = null

        const dpr = window.devicePixelRatio || 1
        const w = c.clientWidth
        const h = c.clientHeight
        c.width = w * dpr
        c.height = h * dpr

        const surface = canvasKit.MakeWebGLCanvasSurface(c)
        if (!surface) {
          setError('WebGL context lost during resize')
          return
        }

        const renderer = new SkiaRenderer(canvasKit, surface)
        rendererRef.current = renderer
        initEditorRefs(canvasKit, renderer)

        renderer.loadFonts().then(() => renderNow())
        renderNow()
      })
    })

    observer.observe(canvas)
    return () => observer.disconnect()
  }, [renderNow])

  const hitTestSectionTitle = useCallback(
    (canvasX: number, canvasY: number): SceneNode | null => {
      const { graph } = getEditorRefs()
      return rendererRef.current?.hitTestSectionTitle(graph, canvasX, canvasY) ?? null
    },
    []
  )

  const hitTestComponentLabel = useCallback(
    (canvasX: number, canvasY: number): SceneNode | null => {
      const { graph } = getEditorRefs()
      return rendererRef.current?.hitTestComponentLabel(graph, canvasX, canvasY) ?? null
    },
    []
  )

  return { canvasRef, isLoading, error, hitTestSectionTitle, hitTestComponentLabel }
}
