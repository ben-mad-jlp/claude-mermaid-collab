// Set up DOM environment BEFORE importing mermaid
import '../services/dom-setup.ts';
import mermaid from 'mermaid';
import * as wireframe from 'mermaid-wireframe';

/**
 * Theme types supported by Mermaid
 */
export type Theme = 'default' | 'dark' | 'forest' | 'neutral';

/**
 * Format types for diagram output
 */
export type Format = 'svg' | 'png';

/**
 * Options for initializing Mermaid
 */
export interface MermaidInitOptions {
  theme?: Theme;
  startOnLoad?: boolean;
  securityLevel?: 'strict' | 'loose' | 'antiscript';
}

/**
 * Result of rendering a diagram
 */
export interface RenderResult {
  svg: string;
  width?: number;
  height?: number;
}

/**
 * Error thrown during Mermaid operations
 */
export class MermaidError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'MermaidError';
  }
}

/**
 * Internal state for Mermaid initialization
 */
let isInitialized = false;
let wireframeRegistered = false;

/**
 * Initialize Mermaid with the given options.
 * This must be called before any rendering operations.
 *
 * @param options - Initialization options
 * @throws {MermaidError} If initialization fails
 */
export async function initializeMermaid(options: MermaidInitOptions = {}): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    // Register wireframe plugin if not already registered
    if (!wireframeRegistered) {
      await mermaid.registerExternalDiagrams([wireframe]);
      wireframeRegistered = true;
    }

    const initConfig: MermaidInitOptions = {
      theme: options.theme || 'default',
      startOnLoad: options.startOnLoad ?? false,
      securityLevel: options.securityLevel || 'strict',
      ...options,
    };

    mermaid.initialize(initConfig);
    isInitialized = true;
  } catch (error) {
    throw new MermaidError(
      'Failed to initialize Mermaid',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Render a Mermaid diagram definition to SVG.
 *
 * @param content - The Mermaid diagram definition
 * @param theme - The theme to use for rendering
 * @returns The rendered SVG as a string
 * @throws {MermaidError} If rendering fails
 */
export async function renderToSVG(content: string, theme: Theme = 'default'): Promise<string> {
  if (!isInitialized) {
    await initializeMermaid({ theme });
  }

  try {
    // Update theme if different from current initialization
    mermaid.initialize({ theme });

    const { svg } = await mermaid.render('diagram', content);
    return svg;
  } catch (error) {
    throw new MermaidError(
      `Failed to render diagram: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Render a Mermaid diagram and extract dimensions from SVG.
 *
 * @param content - The Mermaid diagram definition
 * @param theme - The theme to use for rendering
 * @returns Object containing SVG and extracted dimensions
 * @throws {MermaidError} If rendering fails
 */
export async function renderWithDimensions(
  content: string,
  theme: Theme = 'default',
): Promise<RenderResult> {
  const svg = await renderToSVG(content, theme);

  // Extract dimensions from SVG viewBox or width/height attributes
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  const widthMatch = svg.match(/width="([^"]+)"/);
  const heightMatch = svg.match(/height="([^"]+)"/);

  let width: number | undefined;
  let height: number | undefined;

  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(' ');
    if (parts.length >= 4) {
      width = parseFloat(parts[2]);
      height = parseFloat(parts[3]);
    }
  }

  if (widthMatch && !width) {
    const widthValue = widthMatch[1];
    // Handle units like "100px" or just "100"
    width = parseFloat(widthValue);
  }

  if (heightMatch && !height) {
    const heightValue = heightMatch[1];
    // Handle units like "100px" or just "100"
    height = parseFloat(heightValue);
  }

  return {
    svg,
    width: width && width > 0 ? width : undefined,
    height: height && height > 0 ? height : undefined,
  };
}

/**
 * Validate a Mermaid diagram definition without rendering it.
 * This is useful for checking syntax without the overhead of full rendering.
 *
 * @param content - The Mermaid diagram definition to validate
 * @returns true if valid, false otherwise
 */
export function validateDiagram(content: string): boolean {
  try {
    // Basic validation: check for empty content and common Mermaid keywords
    if (!content || !content.trim()) {
      return false;
    }

    const trimmedContent = content.trim();

    // Check if it starts with a known diagram type
    const diagramTypes = [
      'graph',
      'flowchart',
      'sequenceDiagram',
      'classDiagram',
      'stateDiagram',
      'erDiagram',
      'gantt',
      'pie',
      'gitGraph',
      'requirement',
      'architecture',
      'wireframe',
      'mindmap',
      'timeline',
    ];

    return diagramTypes.some((type) => trimmedContent.startsWith(type));
  } catch {
    return false;
  }
}

/**
 * Get the current theme configuration
 *
 * @returns The current theme
 */
export function getCurrentTheme(): Theme {
  const config = mermaid.mermaidAPI.getConfig();
  return (config.theme as Theme) || 'default';
}

/**
 * Set the theme for subsequent renders
 *
 * @param theme - The theme to set
 * @throws {MermaidError} If setting theme fails
 */
export function setTheme(theme: Theme): void {
  try {
    mermaid.initialize({ theme });
  } catch (error) {
    throw new MermaidError(
      `Failed to set theme: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Reset Mermaid to its initial state.
 * This clears the initialization flag and resets internal state.
 */
export function reset(): void {
  isInitialized = false;
  wireframeRegistered = false;
  try {
    mermaid.contentLoaded();
  } catch {
    // Ignore errors during reset
  }
}

/**
 * Check if Mermaid is initialized
 *
 * @returns true if initialized, false otherwise
 */
export function isInitializedMermaid(): boolean {
  return isInitialized;
}
