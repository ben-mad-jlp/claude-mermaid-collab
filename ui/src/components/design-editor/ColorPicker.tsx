/**
 * ColorPicker Component
 *
 * HSV color picker with saturation/value area, hue slider, opacity slider,
 * and hex input. Appears as a popover triggered by a color swatch.
 *
 * Ported from open-pencil's HsvColorArea.vue + ColorPicker.vue.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { Color } from '@/engine/types'
import { colorToHexRaw, parseColor } from '@/engine/color'

interface ColorPickerProps {
  color: Color
  onChange: (color: Color) => void
  onCommit?: () => void
}

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, v: v * 100 }
}

function hsvToRgb(h: number, s: number, v: number) {
  s /= 100; v /= 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: r + m, g: g + m, b: b + m }
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, onCommit }) => {
  const [open, setOpen] = useState(false)
  const [hue, setHue] = useState(0)
  const [sat, setSat] = useState(100)
  const [val, setVal] = useState(100)
  const [alpha, setAlpha] = useState(1)
  const svRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Sync HSV from incoming color (skip while actively editing to prevent hue snap)
  useEffect(() => {
    if (open) return
    const hsv = rgbToHsv(color.r, color.g, color.b)
    setHue(hsv.h); setSat(hsv.s); setVal(hsv.v); setAlpha(color.a)
  }, [color.r, color.g, color.b, color.a, open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        onCommit?.()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onCommit])

  const emitColor = useCallback((h: number, s: number, v: number, a: number) => {
    const rgb = hsvToRgb(h, s, v)
    onChange({ r: rgb.r, g: rgb.g, b: rgb.b, a })
  }, [onChange])

  const onSvPointerDown = useCallback((e: React.PointerEvent) => {
    const el = svRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    const s = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const v = Math.max(0, Math.min(100, 100 - ((e.clientY - rect.top) / rect.height) * 100))
    setSat(s); setVal(v)
    emitColor(hue, s, v, alpha)
  }, [hue, alpha, emitColor])

  const onSvPointerMove = useCallback((e: React.PointerEvent) => {
    const el = svRef.current
    if (!el || !el.hasPointerCapture(e.pointerId)) return
    const rect = el.getBoundingClientRect()
    const s = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const v = Math.max(0, Math.min(100, 100 - ((e.clientY - rect.top) / rect.height) * 100))
    setSat(s); setVal(v)
    emitColor(hue, s, v, alpha)
  }, [hue, alpha, emitColor])

  const hueRgb = hsvToRgb(hue, 100, 100)
  const hueColor = `rgb(${Math.round(hueRgb.r * 255)}, ${Math.round(hueRgb.g * 255)}, ${Math.round(hueRgb.b * 255)})`

  const swatchColor = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`
  const hexValue = colorToHexRaw(color)

  function onHexChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target.value.replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(input)) return
    const parsed = parseColor(`#${input}`)
    onChange({ ...parsed, a: alpha })
  }

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-5 h-5 shrink-0 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
        style={{ background: swatchColor }}
        aria-label="Pick color"
      />

      {open && (
        <div className="absolute z-50 left-0 top-7 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 shadow-xl">
          {/* SV area */}
          <div
            ref={svRef}
            className="relative h-[140px] w-full cursor-crosshair overflow-hidden rounded"
            style={{ background: hueColor }}
            onPointerDown={onSvPointerDown}
            onPointerMove={onSvPointerMove}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
            <div
              className="pointer-events-none absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
              style={{ left: `${sat}%`, top: `${100 - val}%` }}
            />
          </div>

          {/* Hue slider */}
          <div className="mt-2">
            <input
              type="range"
              min="0" max="360"
              value={hue}
              onChange={(e) => {
                const h = +e.target.value
                setHue(h)
                emitColor(h, sat, val, alpha)
              }}
              className="w-full h-3 rounded-md appearance-none cursor-pointer"
              style={{
                background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
              }}
            />
          </div>

          {/* Alpha slider */}
          <div className="mt-2 relative h-3 rounded-md" style={{
            backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          }}>
            <div
              className="absolute inset-0 rounded-md"
              style={{ background: `linear-gradient(to right, transparent, ${hueColor})` }}
            />
            <input
              type="range"
              min="0" max="100"
              value={Math.round(alpha * 100)}
              onChange={(e) => {
                const a = +e.target.value / 100
                setAlpha(a)
                emitColor(hue, sat, val, a)
              }}
              className="absolute inset-0 w-full h-full appearance-none cursor-pointer bg-transparent"
            />
          </div>

          {/* Hex + alpha input */}
          <div className="mt-2 flex items-center gap-1">
            <span className="text-[11px] text-gray-400">#</span>
            <input
              type="text"
              value={hexValue}
              maxLength={6}
              onChange={onHexChange}
              className="min-w-0 flex-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:text-gray-200"
            />
            <input
              type="number"
              value={Math.round(alpha * 100)}
              min={0}
              max={100}
              onChange={(e) => {
                const a = Math.max(0, Math.min(1, +e.target.value / 100))
                setAlpha(a)
                emitColor(hue, sat, val, a)
              }}
              className="w-10 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1 py-0.5 text-right text-xs text-gray-800 dark:text-gray-200"
            />
            <span className="text-[11px] text-gray-400">%</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default ColorPicker
