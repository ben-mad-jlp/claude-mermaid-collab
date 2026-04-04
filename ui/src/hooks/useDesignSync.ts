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
import { SceneGraph, type SceneNode, createDefaultNode } from '@/engine/scene-graph'
import { getEditorRefs, setSceneGraph, resetSceneGraph } from '@/stores/designEditorRefs'
import { useDesignEditorStore } from '@/stores/designEditorStore'
import { useSessionStore } from '@/stores/sessionStore'
import { api } from '@/lib/api'
import { colorToFill } from '@/engine/color'

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
    // Merge with defaults so MCP-created nodes have all required fields
    const defaults = createDefaultNode(node.type as any)
    const merged = { ...defaults, ...node }

    // Apply props from MCP-created designs to actual node fields
    const props = (node as any).props
    if (props) {
      if (props.fill) {
        try {
          merged.fills = [colorToFill(props.fill)]
        } catch { /* invalid color, keep default */ }
      }
      if (props.text !== undefined) merged.text = props.text
      if (props.fontSize !== undefined) merged.fontSize = props.fontSize
      if (props.fontWeight !== undefined) {
        merged.fontWeight = props.fontWeight === 'bold' ? 700 : Number(props.fontWeight) || 400
      }
      if (props.fontFamily !== undefined) merged.fontFamily = props.fontFamily
      if (props.x !== undefined) merged.x = props.x
      if (props.y !== undefined) merged.y = props.y
      if (props.width !== undefined) merged.width = props.width
      if (props.height !== undefined) merged.height = props.height
      if (props.name !== undefined) merged.name = props.name
      if (props.cornerRadius !== undefined) {
        merged.cornerRadius = props.cornerRadius
        merged.topLeftRadius = props.cornerRadius
        merged.topRightRadius = props.cornerRadius
        merged.bottomLeftRadius = props.cornerRadius
        merged.bottomRightRadius = props.cornerRadius
      }
    }

    graph.nodes.set(node.id, merged)
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
          // Mark the new sceneVersion as "already saved" so the
          // auto-save effect doesn't treat this load as a user edit
          lastSavedVersionRef.current = useDesignEditorStore.getState().sceneVersion
          // Zoom to fit after a frame so canvas dimensions are available
          requestAnimationFrame(() => {
            const vw = window.innerWidth - 240 - 256 // approximate canvas width minus panels
            const vh = window.innerHeight - 48 // minus toolbar
            useDesignEditorStore.getState().zoomToFit(Math.max(vw, 400), Math.max(vh, 300))
          })
        } catch (err) {
          console.warn('Failed to deserialize design on load:', err)
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
          // Ensure lastSavedVersionRef is up to date (covers the
          // case where .then didn't run, e.g. empty design)
          lastSavedVersionRef.current = useDesignEditorStore.getState().sceneVersion
        }
      })

    return () => {
      // Flush pending save synchronously before switching designs
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        // Use the designId from the effect closure (the OLD design),
        // not designIdRef.current which is already the NEW design
        const saveSession = currentSessionRef.current
        if (designId && saveSession && !isSavingRef.current) {
          const { graph } = getEditorRefs()
          const content = serializeGraph(graph)
          // Fire-and-forget save for the old design
          api
            .updateDesign(saveSession.project, saveSession.name, designId, content)
            .catch((err) => console.error('Failed to flush save on cleanup:', err))
        }
      }
    }
  }, [designId, currentSession])

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
        const store = useDesignEditorStore.getState()
        store.initFromGraph()
        lastSavedVersionRef.current = useDesignEditorStore.getState().sceneVersion
      } catch (err) {
        console.warn('Failed to deserialize remote design update:', err)
      }
    },
    []
  )

  return { handleRemoteUpdate }
}
