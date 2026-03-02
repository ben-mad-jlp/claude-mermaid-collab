/**
 * PropertiesPanel Component
 *
 * Right-side panel for editing selected node properties:
 * position, size, rotation, corner radius, opacity, fills, strokes,
 * and text properties.
 *
 * Ported from open-pencil's DesignPanel.vue / PropertiesPanel.vue.
 */

import React, { useState, useCallback, useRef } from 'react'
import { useDesignNodeProps } from '@/hooks/useDesignNodeProps'
import { ColorPicker } from './ColorPicker'
import type { Color } from '@/engine/types'
import type { Fill, Stroke, LayoutMode } from '@/engine/scene-graph'
import { useDesignEditorStore } from '@/stores/designEditorStore'
import { getEditorRefs } from '@/stores/designEditorRefs'

/* ── Tiny reusable bits ────────────────────────────────────── */

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[11px] text-gray-400 dark:text-gray-500 w-4 shrink-0 text-right select-none">
    {children}
  </span>
)

function NumericInput({
  value,
  label,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
}: {
  value: number
  label: string
  onChange: (v: number) => void
  onCommit?: () => void
  min?: number
  max?: number
  step?: number
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    if (!isNaN(v)) onChange(v)
  }
  return (
    <div className="flex items-center gap-1">
      <Label>{label}</Label>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        step={step}
        onChange={handleChange}
        onBlur={onCommit}
        className="min-w-0 flex-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 text-xs text-gray-800 dark:text-gray-200 tabular-nums"
      />
    </div>
  )
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 select-none">
    {children}
  </div>
)

const Divider: React.FC = () => (
  <div className="mx-3 border-b border-gray-100 dark:border-gray-800" />
)

/* ── Main component ────────────────────────────────────────── */

export const PropertiesPanel: React.FC = () => {
  const { node, nodes, updateProp, commitProp, updateNodeWithUndo } = useDesignNodeProps()

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="shrink-0 px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Select a layer to edit its properties
          </p>
        </div>
      </div>
    )
  }

  const isText = node?.type === 'TEXT'
  const isFrame = node?.type === 'FRAME' || node?.type === 'COMPONENT' || node?.type === 'COMPONENT_SET'

  return (
    <div className="flex flex-col h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="shrink-0 px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
        {nodes.length > 1 ? `${nodes.length} layers` : node?.name ?? 'Properties'}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Position & Size ── */}
        {node && (
          <>
            <SectionTitle>Position</SectionTitle>
            <div className="px-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <NumericInput label="X" value={node.x} onChange={(v) => updateProp('x', v)} onCommit={() => commitProp('x')} />
              <NumericInput label="Y" value={node.y} onChange={(v) => updateProp('y', v)} onCommit={() => commitProp('y')} />
              <NumericInput label="W" value={node.width} onChange={(v) => updateProp('width', v)} onCommit={() => commitProp('width')} min={0} />
              <NumericInput label="H" value={node.height} onChange={(v) => updateProp('height', v)} onCommit={() => commitProp('height')} min={0} />
              <NumericInput label="R" value={node.rotation} onChange={(v) => updateProp('rotation', v)} onCommit={() => commitProp('rotation')} />
            </div>
            <Divider />
          </>
        )}

        {/* ── Corner Radius ── */}
        {node && !isText && node.type !== 'LINE' && (
          <>
            <SectionTitle>Corner Radius</SectionTitle>
            <div className="px-3">
              {!node.independentCorners ? (
                <NumericInput
                  label="↱"
                  value={node.cornerRadius}
                  onChange={(v) => updateNodeWithUndo('cornerRadius', v, 'Change corner radius')}
                  min={0}
                />
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <NumericInput label="TL" value={node.topLeftRadius} onChange={(v) => updateNodeWithUndo('topLeftRadius', v)} min={0} />
                  <NumericInput label="TR" value={node.topRightRadius} onChange={(v) => updateNodeWithUndo('topRightRadius', v)} min={0} />
                  <NumericInput label="BL" value={node.bottomLeftRadius} onChange={(v) => updateNodeWithUndo('bottomLeftRadius', v)} min={0} />
                  <NumericInput label="BR" value={node.bottomRightRadius} onChange={(v) => updateNodeWithUndo('bottomRightRadius', v)} min={0} />
                </div>
              )}
            </div>
            <Divider />
          </>
        )}

        {/* ── Opacity ── */}
        {node && (
          <>
            <SectionTitle>Opacity</SectionTitle>
            <div className="px-3">
              <NumericInput
                label="%"
                value={Math.round(node.opacity * 100)}
                onChange={(v) => updateNodeWithUndo('opacity', Math.max(0, Math.min(1, v / 100)), 'Change opacity')}
                min={0}
                max={100}
              />
            </div>
            <Divider />
          </>
        )}

        {/* ── Fills ── */}
        {node && (
          <FillsSection
            fills={node.fills}
            nodeId={node.id}
          />
        )}

        {/* ── Strokes ── */}
        {node && (
          <StrokesSection
            strokes={node.strokes}
            nodeId={node.id}
          />
        )}

        {/* ── Text Properties ── */}
        {isText && node && (
          <TextSection node={node} updateNodeWithUndo={updateNodeWithUndo} />
        )}

        {/* ── Auto Layout ── */}
        {isFrame && node && (
          <AutoLayoutSection node={node} updateNodeWithUndo={updateNodeWithUndo} />
        )}
      </div>
    </div>
  )
}

/* ── Fills Section ─────────────────────────────────────────── */

function FillsSection({ fills, nodeId }: { fills: Fill[]; nodeId: string }) {
  const originalFillsRef = useRef<Fill[] | null>(null)

  const handleColorChange = useCallback((index: number, color: Color) => {
    const { graph } = getEditorRefs()
    const node = graph.getNode(nodeId)
    if (!node) return
    // Capture original fills on first change
    if (!originalFillsRef.current) {
      originalFillsRef.current = node.fills.map(f => ({ ...f }))
    }
    const newFills = [...node.fills]
    newFills[index] = { ...newFills[index], color }
    graph.updateNode(nodeId, { fills: newFills })
    useDesignEditorStore.getState().requestRepaint()
  }, [nodeId])

  const handleColorCommit = useCallback(() => {
    if (originalFillsRef.current) {
      useDesignEditorStore.getState().commitNodeUpdate(
        nodeId,
        { fills: originalFillsRef.current },
        'Change fill color'
      )
      originalFillsRef.current = null
    }
  }, [nodeId])

  const addFill = useCallback(() => {
    const defaultFill: Fill = {
      type: 'SOLID',
      color: { r: 0.85, g: 0.85, b: 0.85, a: 1 },
      opacity: 1,
      visible: true,
    }
    const store = useDesignEditorStore.getState()
    const { graph } = getEditorRefs()
    const node = graph.getNode(nodeId)
    if (!node) return
    store.updateNodeWithUndo(nodeId, { fills: [...node.fills, defaultFill] }, 'Add fill')
  }, [nodeId])

  return (
    <>
      <div className="flex items-center justify-between px-3">
        <SectionTitle>Fill</SectionTitle>
        <button
          onClick={addFill}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
          title="Add fill"
        >
          +
        </button>
      </div>
      <div className="px-3 space-y-1.5">
        {fills.map((fill, i) => (
          fill.type === 'SOLID' && (
            <div key={i} className="flex items-center gap-2">
              <ColorPicker
                color={fill.color}
                onChange={(c) => handleColorChange(i, c)}
                onCommit={handleColorCommit}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">
                Solid
              </span>
              <span className="text-[10px] text-gray-400 tabular-nums">
                {Math.round(fill.opacity * 100)}%
              </span>
            </div>
          )
        ))}
        {fills.length === 0 && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 py-1">No fills</p>
        )}
      </div>
      <Divider />
    </>
  )
}

/* ── Strokes Section ───────────────────────────────────────── */

function StrokesSection({ strokes, nodeId }: { strokes: Stroke[]; nodeId: string }) {
  const originalStrokesRef = useRef<Stroke[] | null>(null)

  const handleColorChange = useCallback((index: number, color: Color) => {
    const { graph } = getEditorRefs()
    const node = graph.getNode(nodeId)
    if (!node) return
    // Capture original strokes on first change
    if (!originalStrokesRef.current) {
      originalStrokesRef.current = node.strokes.map(s => ({ ...s }))
    }
    const newStrokes = [...node.strokes]
    newStrokes[index] = { ...newStrokes[index], color }
    graph.updateNode(nodeId, { strokes: newStrokes })
    useDesignEditorStore.getState().requestRepaint()
  }, [nodeId])

  const handleColorCommit = useCallback(() => {
    if (originalStrokesRef.current) {
      useDesignEditorStore.getState().commitNodeUpdate(
        nodeId,
        { strokes: originalStrokesRef.current },
        'Change stroke color'
      )
      originalStrokesRef.current = null
    }
  }, [nodeId])

  const addStroke = useCallback(() => {
    const defaultStroke: Stroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: 1,
      opacity: 1,
      visible: true,
      align: 'CENTER',
    }
    const store = useDesignEditorStore.getState()
    const { graph } = getEditorRefs()
    const node = graph.getNode(nodeId)
    if (!node) return
    store.updateNodeWithUndo(nodeId, { strokes: [...node.strokes, defaultStroke] }, 'Add stroke')
  }, [nodeId])

  return (
    <>
      <div className="flex items-center justify-between px-3">
        <SectionTitle>Stroke</SectionTitle>
        <button
          onClick={addStroke}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
          title="Add stroke"
        >
          +
        </button>
      </div>
      <div className="px-3 space-y-1.5">
        {strokes.map((stroke, i) => (
          <div key={i} className="flex items-center gap-2">
            <ColorPicker
              color={stroke.color}
              onChange={(c) => handleColorChange(i, c)}
              onCommit={handleColorCommit}
            />
            <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">
              {stroke.weight}px
            </span>
            <span className="text-[10px] text-gray-400">
              {stroke.align.toLowerCase()}
            </span>
          </div>
        ))}
        {strokes.length === 0 && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 py-1">No strokes</p>
        )}
      </div>
      <Divider />
    </>
  )
}

/* ── Text Section ──────────────────────────────────────────── */

function TextSection({
  node,
  updateNodeWithUndo,
}: {
  node: NonNullable<ReturnType<typeof useDesignNodeProps>['node']>
  updateNodeWithUndo: (key: string, value: number | string | boolean, label?: string) => void
}) {
  return (
    <>
      <SectionTitle>Text</SectionTitle>
      <div className="px-3 space-y-1.5">
        <NumericInput
          label="Sz"
          value={node.fontSize}
          onChange={(v) => updateNodeWithUndo('fontSize', v, 'Change font size')}
          min={1}
        />
        <NumericInput
          label="Wt"
          value={node.fontWeight}
          onChange={(v) => updateNodeWithUndo('fontWeight', v, 'Change font weight')}
          min={100}
          max={900}
          step={100}
        />
        <div className="flex items-center gap-1">
          <Label>Al</Label>
          <div className="flex gap-0.5 flex-1">
            {(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'] as const).map((align) => (
              <button
                key={align}
                onClick={() => updateNodeWithUndo('textAlignHorizontal', align, 'Change text align')}
                className={`flex-1 px-1 py-0.5 text-[10px] rounded ${
                  node.textAlignHorizontal === align
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {align[0]}
              </button>
            ))}
          </div>
        </div>
        <NumericInput
          label="Ls"
          value={node.letterSpacing}
          onChange={(v) => updateNodeWithUndo('letterSpacing', v, 'Change letter spacing')}
          step={0.1}
        />
        <NumericInput
          label="Lh"
          value={node.lineHeight ?? 0}
          onChange={(v) => updateNodeWithUndo('lineHeight', v || 0, 'Change line height')}
          min={0}
          step={0.1}
        />
      </div>
      <Divider />
    </>
  )
}

/* ── Auto Layout Section ───────────────────────────────────── */

function AutoLayoutSection({
  node,
  updateNodeWithUndo,
}: {
  node: NonNullable<ReturnType<typeof useDesignNodeProps>['node']>
  updateNodeWithUndo: (key: string, value: number | string | boolean, label?: string) => void
}) {
  if (node.layoutMode === 'NONE') return null

  return (
    <>
      <SectionTitle>Auto Layout</SectionTitle>
      <div className="px-3 space-y-1.5">
        <div className="flex items-center gap-1">
          <Label>Dir</Label>
          <div className="flex gap-0.5 flex-1">
            {(['HORIZONTAL', 'VERTICAL'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => updateNodeWithUndo('layoutMode', mode, 'Change layout direction')}
                className={`flex-1 px-1 py-0.5 text-[10px] rounded ${
                  node.layoutMode === mode
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {mode === 'HORIZONTAL' ? 'H' : 'V'}
              </button>
            ))}
          </div>
        </div>
        <NumericInput
          label="Gap"
          value={node.itemSpacing}
          onChange={(v) => updateNodeWithUndo('itemSpacing', v, 'Change item spacing')}
          min={0}
        />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <NumericInput label="Pt" value={node.paddingTop} onChange={(v) => updateNodeWithUndo('paddingTop', v)} min={0} />
          <NumericInput label="Pr" value={node.paddingRight} onChange={(v) => updateNodeWithUndo('paddingRight', v)} min={0} />
          <NumericInput label="Pb" value={node.paddingBottom} onChange={(v) => updateNodeWithUndo('paddingBottom', v)} min={0} />
          <NumericInput label="Pl" value={node.paddingLeft} onChange={(v) => updateNodeWithUndo('paddingLeft', v)} min={0} />
        </div>
      </div>
      <Divider />
    </>
  )
}

export default PropertiesPanel
