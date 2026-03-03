/**
 * DesignContextMenu Component
 *
 * Right-click context menu for the design editor canvas.
 */

import React, { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDesignEditorStore } from '@/stores/designEditorStore'

interface MenuItem {
  label: string
  shortcut?: string
  action: () => void
  disabled?: boolean
  separator?: false
}

interface MenuSeparator {
  separator: true
}

type MenuEntry = MenuItem | MenuSeparator

export const DesignContextMenu: React.FC = () => {
  const { contextMenu, selectedIds } = useDesignEditorStore(
    useShallow((s) => ({
      contextMenu: s.contextMenu,
      selectedIds: s.selectedIds,
    }))
  )
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    function handleClick() {
      useDesignEditorStore.getState().setContextMenu(null)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        useDesignEditorStore.getState().setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [contextMenu])

  // Clamp menu position to viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { x, y } = contextMenu
    let clamped = false
    if (rect.right > window.innerWidth) {
      x = window.innerWidth - rect.width - 4
      clamped = true
    }
    if (rect.bottom > window.innerHeight) {
      y = window.innerHeight - rect.height - 4
      clamped = true
    }
    if (clamped) {
      menuRef.current.style.left = `${x}px`
      menuRef.current.style.top = `${y}px`
    }
  }, [contextMenu])

  if (!contextMenu) return null

  const store = useDesignEditorStore.getState()
  const hasSelection = selectedIds.size > 0
  const multiSelect = selectedIds.size >= 2
  const selectedNode = store.getSelectedNode()
  const isGroup = selectedNode?.type === 'GROUP'

  const items: MenuEntry[] = [
    { label: 'Duplicate', shortcut: 'Cmd+D', action: () => store.duplicateSelected(), disabled: !hasSelection },
    { label: 'Delete', shortcut: 'Del', action: () => store.deleteSelected(), disabled: !hasSelection },
    { separator: true },
    { label: 'Group', shortcut: 'Cmd+G', action: () => store.groupSelected(), disabled: !multiSelect },
    { label: 'Ungroup', shortcut: 'Cmd+Shift+G', action: () => store.ungroupSelected(), disabled: !isGroup },
    { separator: true },
    { label: 'Bring to Front', shortcut: ']', action: () => store.bringToFront(), disabled: !hasSelection },
    { label: 'Send to Back', shortcut: '[', action: () => store.sendToBack(), disabled: !hasSelection },
    { separator: true },
    { label: 'Flip Horizontal', action: () => store.flipSelected('horizontal'), disabled: !multiSelect },
    { label: 'Flip Vertical', action: () => store.flipSelected('vertical'), disabled: !multiSelect },
  ]

  if (multiSelect) {
    items.push(
      { separator: true },
      { label: 'Align Left', action: () => store.alignNodes('left') },
      { label: 'Align Center H', action: () => store.alignNodes('centerH') },
      { label: 'Align Right', action: () => store.alignNodes('right') },
      { label: 'Align Top', action: () => store.alignNodes('top') },
      { label: 'Align Center V', action: () => store.alignNodes('centerV') },
      { label: 'Align Bottom', action: () => store.alignNodes('bottom') },
    )
    if (selectedIds.size >= 3) {
      items.push(
        { separator: true },
        { label: 'Distribute H', action: () => store.distributeNodes('horizontal') },
        { label: 'Distribute V', action: () => store.distributeNodes('vertical') },
      )
    }
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="my-1 border-t border-gray-100 dark:border-gray-700" />
        }
        return (
          <button
            key={i}
            onClick={() => {
              if (!item.disabled) {
                item.action()
                useDesignEditorStore.getState().setContextMenu(null)
              }
            }}
            disabled={item.disabled}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="text-gray-700 dark:text-gray-300">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-4">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
