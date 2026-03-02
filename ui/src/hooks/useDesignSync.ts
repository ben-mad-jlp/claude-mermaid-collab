/**
 * useDesignSync Hook
 *
 * Handles loading a design's SceneGraph from the API when `designId` changes,
 * and auto-saving SceneGraph back to the API when `sceneVersion` changes
 * (debounced). Also subscribes to WebSocket updates for remote changes.
 *
 * Follows the useDiagram/useDiagramHistory fetch-on-mount pattern.
 */

import { useEffect, useRef, useCallback } from 'react'
import { SceneGraph, type SceneNode } from '@/engine/scene-graph'
import { getEditorRefs, setSceneGraph, resetSceneGraph } from '@/stores/designEditorRefs'
import { useDesignEditorStore } from '@/stores/designEditorStore'
import { useSessionStore } from '@/stores/sessionStore'
import { api } from '@/lib/api'

interface SerializedGraph {
  rootId: string
  nodes: Array<SceneNode & { id: string }>
}

interface SerializedMapEntry<V> {
  key: string
  value: V
}

function serializeGraph(graph: SceneGraph): string {
  const nodes: Array<SceneNode & { id: string }> = []
  for (const node of graph.getAllNodes()) {
    nodes.push({ ...node })
  }

  // Serialize Map fields that JSON.stringify can't handle
  const variables: SerializedMapEntry<unknown>[] = []
  for (const [k, v] of graph.variables) variables.push({ key: k, value: v })

  const variableCollections: SerializedMapEntry<unknown>[] = []
  for (const [k, v] of graph.variableCollections) variableCollections.push({ key: k, value: v })

  const activeMode: SerializedMapEntry<string>[] = []
  for (const [k, v] of graph.activeMode) activeMode.push({ key: k, value: v })

  // Images: encode Uint8Array as base64
  const images: SerializedMapEntry<string>[] = []
  for (const [k, v] of graph.images) {
    let binary = ''
    for (let i = 0; i < v.length; i++) binary += String.fromCharCode(v[i])
    images.push({ key: k, value: btoa(binary) })
  }

  return JSON.stringify({
    rootId: graph.rootId,
    nodes,
    variables,
    variableCollections,
    activeMode,
    images,
  })
}

function deserializeGraph(json: string): SceneGraph {
  const data = JSON.parse(json) as SerializedGraph & {
    variables?: SerializedMapEntry<unknown>[]
    variableCollections?: SerializedMapEntry<unknown>[]
    activeMode?: SerializedMapEntry<string>[]
    images?: SerializedMapEntry<string>[]
  }
  const graph = new SceneGraph()
  graph.nodes.clear()
  graph.rootId = data.rootId
  for (const node of data.nodes) {
    graph.nodes.set(node.id, { ...node })
  }

  // Restore Map fields
  if (data.variables) {
    for (const { key, value } of data.variables) graph.variables.set(key, value as never)
  }
  if (data.variableCollections) {
    for (const { key, value } of data.variableCollections) graph.variableCollections.set(key, value as never)
  }
  if (data.activeMode) {
    for (const { key, value } of data.activeMode) graph.activeMode.set(key, value)
  }
  if (data.images) {
    for (const { key, value } of data.images) {
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      graph.images.set(key, bytes)
    }
  }

  return graph
}

const SAVE_DEBOUNCE_MS = 1000

export function useDesignSync(designId: string | null) {
  const lastSavedVersionRef = useRef(-1)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadingRef = useRef(false)
  const isSavingRef = useRef(false)
  const designIdRef = useRef(designId)
  designIdRef.current = designId

  const currentSession = useSessionStore((s) => s.currentSession)
  const currentSessionRef = useRef(currentSession)
  currentSessionRef.current = currentSession
  const updateDesign = useSessionStore((s) => s.updateDesign)

  const sceneVersion = useDesignEditorStore((s) => s.sceneVersion)
  const requestRender = useDesignEditorStore((s) => s.requestRender)

  // Load design from API when designId changes
  useEffect(() => {
    if (!designId || !currentSession) {
      resetSceneGraph()
      lastSavedVersionRef.current = -1
      return
    }

    isLoadingRef.current = true

    api
      .getDesign(currentSession.project, currentSession.name, designId)
      .then((design) => {
        // Bail if designId changed while loading
        if (designIdRef.current !== designId) return
        if (!design?.content) {
          resetSceneGraph()
          return
        }
        try {
          const graph = deserializeGraph(design.content)
          setSceneGraph(graph)
          const store = useDesignEditorStore.getState()
          store.initFromGraph()
          // Zoom to fit after a frame so canvas dimensions are available
          requestAnimationFrame(() => {
            const vw = window.innerWidth - 240 - 256 // approximate canvas width minus panels
            const vh = window.innerHeight - 48 // minus toolbar
            useDesignEditorStore.getState().zoomToFit(Math.max(vw, 400), Math.max(vh, 300))
          })
        } catch {
          resetSceneGraph()
        }
      })
      .catch(() => {
        if (designIdRef.current !== designId) return
        resetSceneGraph()
      })
      .finally(() => {
        if (designIdRef.current === designId) {
          isLoadingRef.current = false
          lastSavedVersionRef.current = useDesignEditorStore.getState().sceneVersion
          requestRender()
        }
      })

    return () => {
      // Flush pending save synchronously before switching designs
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        const saveDesignId = designIdRef.current
        const saveSession = currentSessionRef.current
        if (saveDesignId && saveSession && !isSavingRef.current) {
          const { graph } = getEditorRefs()
          const content = serializeGraph(graph)
          // Fire-and-forget save for the old design
          api
            .updateDesign(saveSession.project, saveSession.name, saveDesignId, content)
            .catch((err) => console.error('Failed to flush save on cleanup:', err))
        }
      }
    }
  }, [designId, currentSession, requestRender])

  // Auto-save when sceneVersion changes (debounced)
  useEffect(() => {
    if (!designId || !currentSession) return
    if (isLoadingRef.current) return
    if (sceneVersion <= lastSavedVersionRef.current) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      // Read current values from refs to avoid stale closure
      const saveDesignId = designIdRef.current
      const saveSession = currentSessionRef.current
      if (!saveDesignId || !saveSession || isSavingRef.current) return

      isSavingRef.current = true
      const { graph } = getEditorRefs()
      const content = serializeGraph(graph)
      const savedVersion = sceneVersion

      api
        .updateDesign(saveSession.project, saveSession.name, saveDesignId, content)
        .then(() => {
          lastSavedVersionRef.current = savedVersion
          updateDesign(saveDesignId, { lastModified: Date.now() })
        })
        .catch((err) => {
          console.error('Failed to save design:', err)
        })
        .finally(() => {
          isSavingRef.current = false
        })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [sceneVersion, designId, currentSession, updateDesign])

  // Handle incoming WebSocket updates for this design
  const handleRemoteUpdate = useCallback(
    (content: string) => {
      if (isLoadingRef.current) return
      try {
        const graph = deserializeGraph(content)
        setSceneGraph(graph)
        lastSavedVersionRef.current = useDesignEditorStore.getState().sceneVersion
        requestRender()
      } catch {
        // Ignore malformed remote updates
      }
    },
    [requestRender]
  )

  return { handleRemoteUpdate }
}
