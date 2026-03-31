/**
 * Unified item types for sidebar and editor components
 *
 * Provides type definitions and utilities for handling all artifact types
 * (diagrams, documents, designs, spreadsheets, snippets) in a unified way.
 */

import type React from 'react';

/**
 * ItemType: Union of all artifact types
 * Represents any artifact that can be created and edited in the system
 */
export type ItemType = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet';

/**
 * ItemMetadata: Common properties shared by all artifacts
 * Provides a unified interface for working with any artifact type
 */
export interface ItemMetadata {
  /** Unique identifier for the artifact */
  id: string;
  /** Human-readable name of the artifact */
  name: string;
  /** Type of artifact */
  type: ItemType;
  /** Full content of the artifact */
  content: string;
  /** Last modification timestamp in milliseconds */
  lastModified: number;
  /** Optional folder/path for organization */
  folder?: string;
  /** Whether the artifact is currently locked for editing */
  locked?: boolean;
  /** Whether the artifact is deprecated (hidden by default) */
  deprecated?: boolean;
  /** Whether the artifact is pinned to the top of the list */
  pinned?: boolean;
}

/**
 * Unified item type for sidebar (diagram, document, design, spreadsheet, or snippet)
 * Extends ItemMetadata for backward compatibility
 */
export interface Item extends ItemMetadata {
  // Intentionally empty - inherits from ItemMetadata
}

/**
 * Type guard: Check if a value is an Item
 */
export function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.lastModified === 'number' &&
    isItemType(obj.type)
  );
}

/**
 * Type guard: Check if a type value is a valid ItemType
 */
export function isItemType(value: unknown): value is ItemType {
  return (
    value === 'diagram' ||
    value === 'document' ||
    value === 'design' ||
    value === 'spreadsheet' ||
    value === 'snippet'
  );
}

/**
 * Type guard: Check if an Item is a diagram
 */
export function isDiagram(item: Item): item is Item & { type: 'diagram' } {
  return item.type === 'diagram';
}

/**
 * Type guard: Check if an Item is a document
 */
export function isDocument(item: Item): item is Item & { type: 'document' } {
  return item.type === 'document';
}

/**
 * Type guard: Check if an Item is a design
 */
export function isDesign(item: Item): item is Item & { type: 'design' } {
  return item.type === 'design';
}

/**
 * Type guard: Check if an Item is a spreadsheet
 */
export function isSpreadsheet(item: Item): item is Item & { type: 'spreadsheet' } {
  return item.type === 'spreadsheet';
}

/**
 * Type guard: Check if an Item is a snippet
 */
export function isSnippet(item: Item): item is Item & { type: 'snippet' } {
  return item.type === 'snippet';
}

/**
 * Get human-readable label for an item type
 */
export function getItemLabel(type: ItemType): string {
  const labels: Record<ItemType, string> = {
    diagram: 'Diagram',
    document: 'Document',
    design: 'Design',
    spreadsheet: 'Spreadsheet',
    snippet: 'Snippet',
  };
  return labels[type];
}

/**
 * Get SVG path data for an item type icon
 */
export function getItemIconPath(type: ItemType): string {
  const paths: Record<ItemType, string> = {
    diagram: 'M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21',
    design: 'M3 9h18M9 21V9',
    spreadsheet: 'M3 9h18M3 15h18M9 3v18M15 3v18',
    snippet: 'M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    document: 'M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  };
  return paths[type];
}

/**
 * Get SVG viewBox for an item type icon
 */
export function getItemIconViewBox(type: ItemType): string {
  return type === 'design' ? '0 0 24 24' : '0 0 24 24';
}

/**
 * Get icon SVG markup as a string for an item type
 * Returns SVG HTML string that can be rendered as needed
 */
export function getItemIconSvg(type: ItemType): string {
  const iconPath = getItemIconPath(type);

  if (type === 'design') {
    return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="${iconPath}" />
    </svg>`;
  }

  return `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="${iconPath}" />
  </svg>`;
}

/**
 * Get color accent for an item type (for UI styling)
 */
export function getItemColor(type: ItemType): string {
  const colors: Record<ItemType, string> = {
    diagram: 'blue',
    document: 'purple',
    design: 'pink',
    spreadsheet: 'green',
    snippet: 'orange',
  };
  return colors[type];
}

/**
 * Get CSS color value for an item type
 */
export function getItemColorValue(type: ItemType): string {
  const colorMap: Record<ItemType, string> = {
    diagram: '#3b82f6',
    document: '#a855f7',
    design: '#ec4899',
    spreadsheet: '#10b981',
    snippet: '#f97316',
  };
  return colorMap[type];
}

/**
 * Editor toolbar action
 * Represents an action that can be performed in the editor toolbar
 */
export interface ToolbarAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean; // Show in primary toolbar vs overflow
}
