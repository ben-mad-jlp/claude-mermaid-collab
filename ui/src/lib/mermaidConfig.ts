/**
 * Centralized Mermaid configuration
 *
 * Handles mermaid initialization for standard diagram types.
 * Note: Wireframe diagrams now use the JSON-based rough.js renderer,
 * not Mermaid's external diagram system.
 */

import mermaid from 'mermaid';

/**
 * Initialize mermaid with theme
 *
 * Note: We intentionally don't set global themeVariables here because they
 * would override diagram-level %%{init}%% directives. Mermaid's built-in
 * 'dark' theme provides good defaults, and individual diagrams can customize
 * colors via their own init directives.
 */
export async function initializeMermaid(theme: 'light' | 'dark'): Promise<void> {
  const config: any = {
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
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
