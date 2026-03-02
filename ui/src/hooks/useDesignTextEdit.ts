/**
 * useDesignTextEdit Hook
 *
 * Manages an invisible textarea for text input when editing text nodes.
 * Handles IME composition, caret blinking, keyboard navigation, and
 * formatting shortcuts (bold, italic, underline).
 *
 * Ported from open-pencil's use-text-edit.ts.
 */

import { useEffect, useRef } from 'react'
import {
  adjustRunsForDelete,
  adjustRunsForInsert,
  toggleBoldInRange,
  toggleItalicInRange,
  toggleDecorationInRange,
} from '@/engine/style-runs'
import type { SceneNode } from '@/engine/scene-graph'
import { getEditorRefs } from '@/stores/designEditorRefs'
import { useDesignEditorStore } from '@/stores/designEditorStore'

const CARET_BLINK_MS = 530

export function useDesignTextEdit(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const blinkTimerRef = useRef(0)

  const editingTextId = useDesignEditorStore((s) => s.editingTextId)

  useEffect(() => {
    if (!editingTextId) {
      // Clean up when editing stops
      if (textareaRef.current) {
        textareaRef.current.remove()
        textareaRef.current = null
      }
      clearInterval(blinkTimerRef.current)
      isComposingRef.current = false
      return
    }

    // Create hidden textarea for text input
    const el = document.createElement('textarea')
    el.style.cssText =
      'position:fixed;opacity:0;width:1px;height:1px;padding:0;border:0;top:50%;left:50%;overflow:hidden;resize:none;'
    el.autocomplete = 'off'
    el.setAttribute('autocorrect', 'off')
    el.setAttribute('autocapitalize', 'none')
    el.spellcheck = false
    el.tabIndex = -1
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
    textareaRef.current = el
    el.focus()

    const store = useDesignEditorStore.getState
    const refs = () => getEditorRefs()

    function getEditingNode(): SceneNode | null {
      const id = store().editingTextId
      if (!id) return null
      return refs().graph.getNode(id) ?? null
    }

    function resetBlink() {
      const { textEditor } = refs()
      if (textEditor) textEditor.caretVisible = true
      clearInterval(blinkTimerRef.current)
      blinkTimerRef.current = window.setInterval(() => {
        const { textEditor: te } = refs()
        if (!te) return
        te.caretVisible = !te.caretVisible
        store().requestRepaint()
      }, CARET_BLINK_MS)
      store().requestRepaint()
    }

    function syncText(nodeId: string, text: string, runs?: SceneNode['styleRuns']) {
      const changes: Partial<SceneNode> = { text }
      if (runs !== undefined) changes.styleRuns = runs
      refs().graph.updateNode(nodeId, changes)
      store().requestRender()
    }

    function insertText(text: string, node: SceneNode) {
      const { textEditor } = refs()
      if (!textEditor) return
      const range = textEditor.getSelectionRange()
      let runs = node.styleRuns
      if (range) {
        runs = adjustRunsForDelete(runs, range[0], range[1] - range[0])
        runs = adjustRunsForInsert(runs, range[0], text.length)
      } else {
        runs = adjustRunsForInsert(runs, textEditor.state?.cursor ?? 0, text.length)
      }
      textEditor.insert(text, node)
      syncText(node.id, textEditor.state?.text ?? '', runs)
    }

    function deleteText(node: SceneNode, forward: boolean) {
      const { textEditor } = refs()
      if (!textEditor) return
      const range = textEditor.getSelectionRange()
      let runs = node.styleRuns
      if (range) {
        runs = adjustRunsForDelete(runs, range[0], range[1] - range[0])
      } else if (forward && textEditor.state && textEditor.state.cursor < node.text.length) {
        runs = adjustRunsForDelete(runs, textEditor.state.cursor, 1)
      } else if (!forward && textEditor.state && textEditor.state.cursor > 0) {
        runs = adjustRunsForDelete(runs, textEditor.state.cursor - 1, 1)
      }
      if (forward) textEditor.delete(node)
      else textEditor.backspace(node)
      syncText(node.id, textEditor.state?.text ?? '', runs)
    }

    function applyFormatting(nodeId: string, changes: Partial<SceneNode>, label: string) {
      store().updateNodeWithUndo(nodeId, changes, label)
      const updated = refs().graph.getNode(nodeId)
      if (updated) refs().textEditor?.rebuildParagraph(updated)
      store().requestRender()
    }

    function onCompositionStart() { isComposingRef.current = true }
    function onCompositionEnd(e: CompositionEvent) {
      isComposingRef.current = false
      if (!e.data) return
      const node = getEditingNode()
      if (!node) return
      insertText(e.data, node)
      if (textareaRef.current) textareaRef.current.value = ''
      resetBlink()
    }

    function onInput() {
      if (isComposingRef.current || !textareaRef.current) return
      const text = textareaRef.current.value
      if (!text) return
      textareaRef.current.value = ''
      const node = getEditingNode()
      if (!node) return
      insertText(text, node)
      resetBlink()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isComposingRef.current) return
      const { textEditor } = refs()
      const node = getEditingNode()
      if (!textEditor || !node) return

      const isMeta = e.metaKey || e.ctrlKey
      let textChanged = false

      switch (e.key) {
        case 'Escape':
          store().commitTextEdit()
          canvasRef.current?.focus()
          e.preventDefault()
          return
        case 'Enter':
          insertText('\n', node); textChanged = true; break
        case 'Backspace':
          if (isMeta) textEditor.moveToLineStart(true)
          else if (e.altKey) textEditor.moveWordLeft(true)
          deleteText(node, false); textChanged = true; break
        case 'Delete':
          if (isMeta) textEditor.moveToLineEnd(true)
          else if (e.altKey) textEditor.moveWordRight(true)
          deleteText(node, true); textChanged = true; break
        case 'ArrowLeft':
          if (isMeta) textEditor.moveToLineStart(e.shiftKey)
          else if (e.altKey) textEditor.moveWordLeft(e.shiftKey)
          else textEditor.moveLeft(e.shiftKey); break
        case 'ArrowRight':
          if (isMeta) textEditor.moveToLineEnd(e.shiftKey)
          else if (e.altKey) textEditor.moveWordRight(e.shiftKey)
          else textEditor.moveRight(e.shiftKey); break
        case 'ArrowUp': textEditor.moveUp(e.shiftKey); break
        case 'ArrowDown': textEditor.moveDown(e.shiftKey); break
        case 'Home': textEditor.moveToLineStart(e.shiftKey); break
        case 'End': textEditor.moveToLineEnd(e.shiftKey); break
        case 'a':
          if (isMeta) { textEditor.selectAll(); break }
          return
        case 'c':
          if (isMeta) {
            const text = textEditor.getSelectedText()
            if (text) navigator.clipboard.writeText(text)
            e.preventDefault()
          }
          return
        case 'x':
          if (isMeta) {
            const text = textEditor.getSelectedText()
            if (text) { navigator.clipboard.writeText(text); deleteText(node, false); resetBlink() }
            e.preventDefault()
          }
          return
        case 'v':
          if (isMeta) {
            navigator.clipboard.readText().then((text) => {
              if (!text) return
              // Re-read the current editing node to avoid stale reference
              const currentEditId = store().editingTextId
              if (!currentEditId) return
              const currentNode = refs().graph.getNode(currentEditId)
              if (!currentNode) return
              insertText(text, currentNode)
              resetBlink()
            }).catch(() => {})
            e.preventDefault()
          }
          return
        case 'b':
          if (isMeta) {
            const range = textEditor.getSelectionRange()
            if (range) {
              const { runs } = toggleBoldInRange(node.styleRuns, range[0], range[1], node.fontWeight, node.text.length)
              applyFormatting(node.id, { styleRuns: runs }, 'Toggle bold')
            } else {
              applyFormatting(node.id, { fontWeight: node.fontWeight >= 700 ? 400 : 700 }, 'Toggle bold')
            }
            e.preventDefault()
          }
          return
        case 'i':
          if (isMeta) {
            const range = textEditor.getSelectionRange()
            if (range) {
              const { runs } = toggleItalicInRange(node.styleRuns, range[0], range[1], node.italic, node.text.length)
              applyFormatting(node.id, { styleRuns: runs }, 'Toggle italic')
            } else {
              applyFormatting(node.id, { italic: !node.italic }, 'Toggle italic')
            }
            e.preventDefault()
          }
          return
        case 'u':
          if (isMeta) {
            const range = textEditor.getSelectionRange()
            if (range) {
              const { runs } = toggleDecorationInRange(node.styleRuns, range[0], range[1], 'UNDERLINE', node.textDecoration, node.text.length)
              applyFormatting(node.id, { styleRuns: runs }, 'Toggle underline')
            } else {
              applyFormatting(node.id, { textDecoration: node.textDecoration === 'UNDERLINE' ? 'NONE' : 'UNDERLINE' }, 'Toggle underline')
            }
            e.preventDefault()
          }
          return
        default: return
      }

      if (!textChanged) store().requestRender()
      resetBlink()
      e.preventDefault()
    }

    // Focus textarea when canvas is clicked during text edit
    function onCanvasMouseDown() {
      if (store().editingTextId && textareaRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    }

    el.addEventListener('input', onInput)
    el.addEventListener('compositionstart', onCompositionStart)
    el.addEventListener('compositionend', onCompositionEnd)
    el.addEventListener('keydown', onKeyDown)
    canvasRef.current?.addEventListener('mousedown', onCanvasMouseDown)

    resetBlink()

    return () => {
      clearInterval(blinkTimerRef.current)
      el.removeEventListener('input', onInput)
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
      el.removeEventListener('keydown', onKeyDown)
      canvasRef.current?.removeEventListener('mousedown', onCanvasMouseDown)
      el.remove()
      textareaRef.current = null
      isComposingRef.current = false
    }
  }, [editingTextId, canvasRef])
}
