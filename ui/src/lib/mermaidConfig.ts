/**
 * Centralized Mermaid configuration
 *
 * Handles mermaid initialization for standard diagram types.
 * Note: Design diagrams now use the JSON-based rough.js renderer,
 * not Mermaid's external diagram system.
 */

import mermaid from 'mermaid';
import { readThemeColor } from './themeTokens';

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
 * For diagrams without custom init, we drive Mermaid's `base` theme from the
 * app's semantic design tokens (read off `:root` at runtime) so authored
 * diagrams follow light/dark/sepia instead of the stock mermaid `default` look.
 */
export async function initializeMermaid(theme: 'light' | 'dark', diagramContent?: string): Promise<void> {
  const hasCustom = diagramContent && hasCustomInit(diagramContent);

  const config: any = {
    startOnLoad: false,
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: false,
      wrap: true,
      nodeSpacing: 30,
    },
  };

  // Only set the global theme if the diagram doesn't bring its own %%{init}%%.
  // Use Mermaid's `base` theme and map its themeVariables onto the app's
  // semantic tokens so node/edge colors track the active app theme. Fallbacks
  // mirror the legacy light/dark look for non-DOM / token-less contexts.
  if (!hasCustom) {
    const dark = theme === 'dark';
    const surface = readThemeColor('--color-surface', dark ? '#1e293b' : '#ffffff');
    const border = readThemeColor('--color-border', dark ? '#475569' : '#d1d5db');
    const text = readThemeColor('--color-text', dark ? '#f1f5f9' : '#111827');
    const muted = readThemeColor('--color-muted', dark ? '#64748b' : '#9ca3af');
    const cluster = readThemeColor('--color-surface-muted', dark ? '#0f172a' : '#f9fafb');
    const accent = readThemeColor('--color-accent-500', '#0ea5e9');

    config.theme = 'base';
    config.themeVariables = {
      background: surface,
      primaryColor: surface,
      primaryBorderColor: border,
      primaryTextColor: text,
      secondaryColor: cluster,
      tertiaryColor: cluster,
      mainBkg: surface,
      nodeBorder: border,
      nodeTextColor: text,
      clusterBkg: cluster,
      clusterBorder: border,
      lineColor: muted,
      titleColor: text,
      edgeLabelBackground: surface,
      textColor: text,
      // Accent the primary line/link tone so diagrams feel on-brand.
      lineColorPrimary: accent,
    };
  }

  mermaid.initialize(config);
}

/**
 * Check if a diagram content is a design diagram
 * Designs now use JSON format, not Mermaid syntax
 */
export function isDesignDiagram(content: string): boolean {
  // Legacy check for old Mermaid wireframe syntax
  if (/^\s*wireframe\s/m.test(content)) {
    return true;
  }
  // New JSON designs start with { and have viewport/screens
  try {
    const parsed = JSON.parse(content);
    return parsed.viewport && parsed.screens;
  } catch {
    return false;
  }
}
