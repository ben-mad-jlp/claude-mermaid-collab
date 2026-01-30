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
 * Note: We use 'base' theme when diagrams have custom init directives to
 * allow diagram-level styling to take full control. For diagrams without
 * custom init, we use the app's theme for good defaults.
 */
export async function initializeMermaid(theme: 'light' | 'dark', diagramContent?: string): Promise<void> {
  // If diagram has custom init directive, use 'base' theme to let diagram control styling
  // Otherwise, use the app's theme for sensible defaults
  const useCustomTheme = diagramContent && hasCustomInit(diagramContent);

  const config: any = {
    startOnLoad: false,
    theme: useCustomTheme ? 'base' : (theme === 'dark' ? 'dark' : 'default'),
    securityLevel: 'loose',
  };

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
