/**
 * Module-level singletons for non-serializable design editor objects.
 *
 * These are kept outside Zustand because they contain WASM handles,
 * GPU resources, and mutable data structures that shouldn't be in
 * React state.
 */

import type { CanvasKit } from 'canvaskit-wasm'
import type { SkiaRenderer } from '@/engine/renderer'
import { SceneGraph } from '@/engine/scene-graph'
import { UndoManager } from '@/engine/undo'
import { TextEditor } from '@/engine/text-editor'

interface EditorRefs {
  graph: SceneGraph
  undo: UndoManager
  canvasKit: CanvasKit | null
  renderer: SkiaRenderer | null
  textEditor: TextEditor | null
}

const refs: EditorRefs = {
  graph: new SceneGraph(),
  undo: new UndoManager(),
  canvasKit: null,
  renderer: null,
  textEditor: null,
}

export function getEditorRefs(): EditorRefs {
  return refs
}

export function initEditorRefs(ck: CanvasKit, renderer: SkiaRenderer): void {
  refs.canvasKit = ck
  refs.renderer = renderer
  refs.textEditor = new TextEditor(ck)
  refs.textEditor.setRenderer(renderer)
}

export function destroyEditorRefs(): void {
  refs.renderer?.destroy()
  refs.renderer = null
  refs.canvasKit = null
  refs.textEditor = null
  refs.graph = new SceneGraph()
  refs.undo.clear()
}

export function resetSceneGraph(): void {
  refs.graph = new SceneGraph()
  refs.undo.clear()
}

export function setSceneGraph(graph: SceneGraph): void {
  refs.graph = graph
  refs.undo.clear()
}
