/**
 * useDesignNodeProps Hook
 *
 * Derives property values from selected nodes and provides setters
 * for updating them with undo support. Used by the PropertiesPanel.
 *
 * Ported from open-pencil's use-node-props.ts.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDesignEditorStore } from '@/stores/designEditorStore'
import { getEditorRefs } from '@/stores/designEditorRefs'
import type { SceneNode } from '@/engine/scene-graph'

export function useDesignNodeProps() {
  const selectedIds = useDesignEditorStore((s) => s.selectedIds)
  const sceneVersion = useDesignEditorStore((s) => s.sceneVersion)

  // Track original values before editing begins (set on first updateProp call, cleared on commitProp)
  const originalsRef = useRef<Map<string, Record<string, unknown>>>(new Map())

  // Clear originals when selection changes to prevent stale entries
  useEffect(() => {
    originalsRef.current.clear()
  }, [selectedIds])

  const nodes = useMemo(() => {
    // Re-derive when sceneVersion changes
    void sceneVersion
    return useDesignEditorStore.getState().getSelectedNodes()
  }, [selectedIds, sceneVersion])

  const node = nodes.length === 1 ? nodes[0] : null

  const updateProp = useCallback(
    (key: string, value: number | string | boolean) => {
      const store = useDesignEditorStore.getState()
      const { graph } = getEditorRefs()

      // Capture original value before first edit
      const selectedNodes = store.getSelectedNodes()
      for (const n of selectedNodes) {
        if (!originalsRef.current.has(n.id)) {
          originalsRef.current.set(n.id, {})
        }
        const orig = originalsRef.current.get(n.id)!
        if (!(key in orig)) {
          const liveNode = graph.getNode(n.id)
          if (liveNode) orig[key] = liveNode[key as keyof SceneNode]
        }
      }

      if (selectedNodes.length > 1) {
        for (const n of selectedNodes) {
          store.updateNode(n.id, { [key]: value } as Partial<SceneNode>)
        }
      } else {
        const n = store.getSelectedNode()
        if (n) store.updateNode(n.id, { [key]: value } as Partial<SceneNode>)
      }
    },
    [nodes.length]
  )

  const commitProp = useCallback(
    (key: string) => {
      const store = useDesignEditorStore.getState()

      // Use the captured originals as the "previous" value
      const selectedNodes = store.getSelectedNodes()
      for (const n of selectedNodes) {
        const orig = originalsRef.current.get(n.id)
        if (orig && key in orig) {
          store.commitNodeUpdate(n.id, { [key]: orig[key] } as Partial<SceneNode>, `Change ${key}`)
        }
      }

      // Clear originals for committed keys
      for (const [id, orig] of originalsRef.current) {
        delete orig[key]
        if (Object.keys(orig).length === 0) originalsRef.current.delete(id)
      }
    },
    [nodes.length]
  )

  const updateNodeWithUndo = useCallback(
    (key: string, value: number | string | boolean, label?: string) => {
      const store = useDesignEditorStore.getState()
      if (nodes.length > 1) {
        for (const n of store.getSelectedNodes()) {
          store.updateNodeWithUndo(n.id, { [key]: value } as Partial<SceneNode>, label ?? `Change ${key}`)
        }
      } else {
        const n = store.getSelectedNode()
        if (n) store.updateNodeWithUndo(n.id, { [key]: value } as Partial<SceneNode>, label ?? `Change ${key}`)
      }
    },
    [nodes.length]
  )

  return { node, nodes, updateProp, commitProp, updateNodeWithUndo }
}
