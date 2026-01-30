/**
 * Centralized Mermaid configuration
 *
 * Handles mermaid initialization for standard diagram types.
 * Note: Wireframe diagrams now use the JSON-based rough.js renderer,
 * not Mermaid's external diagram system.
 */

import mermaid from 'mermaid';

/**
 * Check if diagram content has its own init directive
 */
export function hasCustomInit(content: string): boolean {
  return /%%\s*\{.*init.*\}.*%%/is.test(content);
}

/**
 * Initialize mermaid with theme
 *
 * Note: When a diagram has its own %%{init}%% directive, we don't set a
 * global theme to let the diagram's directive take full control. This allows
 * diagrams to specify their own theme (dark, base, default) or custom styling.
 * For diagrams without custom init, we use the app's theme for good defaults.
 */
export async function initializeMermaid(theme: 'light' | 'dark', diagramContent?: string): Promise<void> {
  const hasCustom = diagramContent && hasCustomInit(diagramContent);

  const config: any = {
    startOnLoad: false,
    securityLevel: 'loose',
  };

  // Only set global theme if diagram doesn't have its own init directive
  // This lets diagram-level %%{init}%% directives take full control
  if (!hasCustom) {
    config.theme = theme === 'dark' ? 'dark' : 'default';
  }

  mermaid.initialize(config);
}

/**
 * Check if a diagram content is a wireframe diagram
 * Wireframes now use JSON format, not Mermaid syntax
 */
export function isWireframeDiagram(content: string): boolean {
  // Legacy check for old Mermaid wireframe syntax
  if (/^\s*wireframe\s/m.test(content)) {
    return true;
  }
  // New JSON wireframes start with { and have viewport/screens
  try {
    const parsed = JSON.parse(content);
    return parsed.viewport && parsed.screens;
  } catch {
    return false;
  }
}
