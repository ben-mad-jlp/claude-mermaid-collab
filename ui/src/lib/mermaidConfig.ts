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
 */
export async function initializeMermaid(theme: 'light' | 'dark'): Promise<void> {
  const config: any = {
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
  };

  // Apply dark mode theme variables for better contrast
  if (theme === 'dark') {
    config.themeVariables = {
      primaryColor: '#4a9eff',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#3a7bd5',
      lineColor: '#888888',
      secondaryColor: '#2d5a8c',
      tertiaryColor: '#1e3a5f',
      background: '#1a1a2e',
      mainBkg: '#1a1a2e',
      nodeBorder: '#4a9eff',
      clusterBkg: '#2d3748',
      titleColor: '#ffffff',
      edgeLabelBackground: '#1a1a2e',
    };
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
