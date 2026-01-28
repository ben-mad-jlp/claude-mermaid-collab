/**
 * Centralized Mermaid configuration
 *
 * Handles mermaid initialization and plugin registration.
 * Ensures the wireframe plugin is registered before any diagram rendering.
 */

import mermaid from 'mermaid';

// Track registration state to avoid double registration
let pluginRegistered = false;
let registrationPromise: Promise<void> | null = null;

/**
 * Register the wireframe plugin with Mermaid
 * This must be called before any wireframe diagrams can be rendered
 */
export async function registerWireframePlugin(): Promise<void> {
  // Return existing promise if registration is in progress
  if (registrationPromise) {
    return registrationPromise;
  }

  // Skip if already registered
  if (pluginRegistered) {
    return;
  }

  registrationPromise = (async () => {
    try {
      // Dynamic import of the wireframe plugin
      const wireframe = await import('mermaid-wireframe');
      await mermaid.registerExternalDiagrams([wireframe]);
      pluginRegistered = true;
    } catch (error) {
      console.warn('Failed to register wireframe plugin:', error);
      // Don't throw - diagrams without wireframe should still work
    }
  })();

  return registrationPromise;
}

/**
 * Initialize mermaid with theme and register plugins
 */
export async function initializeMermaid(theme: 'light' | 'dark'): Promise<void> {
  // Ensure wireframe plugin is registered first
  await registerWireframePlugin();

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
 */
export function isWireframeDiagram(content: string): boolean {
  return /^\s*wireframe\s/m.test(content);
}
