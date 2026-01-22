/**
 * Mermaid Formatter Utility
 *
 * Formats Mermaid diagram syntax for improved readability.
 * - Normalizes indentation (configurable, default 2 spaces)
 * - Normalizes arrow syntax with consistent spacing
 * - Handles subgraph indentation correctly
 * - Preserves diagram semantics
 */

export interface FormatOptions {
  indentSize?: number;  // default: 2
  maxLineLength?: number;  // default: 80
}

export interface FormatResult {
  formatted: string;
  success: boolean;
  error?: string;
}

/**
 * Formats Mermaid diagram syntax
 *
 * Processes:
 * - Normalizes indentation based on subgraph depth
 * - Normalizes arrow operators (-->, ---, -.->,->, ==>)
 * - Removes empty lines
 * - Preserves first line (diagram type declaration)
 */
export function formatMermaid(content: string, options: FormatOptions = {}): FormatResult {
  const indentSize = options.indentSize ?? 2;
  const indent = ' '.repeat(indentSize);

  try {
    const lines = content.split('\n');
    const result: string[] = [];
    let currentIndent = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        continue;
      }

      // Detect diagram type on first line (graph, flowchart, sequenceDiagram, etc.)
      if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/i.test(trimmed)) {
        result.push(trimmed);
        continue;
      }

      // Handle subgraph start
      if (trimmed.toLowerCase().startsWith('subgraph')) {
        result.push(indent.repeat(currentIndent) + trimmed);
        currentIndent++;
        continue;
      }

      // Handle subgraph end
      if (trimmed === 'end') {
        currentIndent = Math.max(0, currentIndent - 1);
        result.push(indent.repeat(currentIndent) + trimmed);
        continue;
      }

      // Normalize arrow syntax with consistent spacing
      let formatted = trimmed
        .replace(/\s*-->\s*/g, ' --> ')
        .replace(/\s*---\s*/g, ' --- ')
        .replace(/\s*-\.->\s*/g, ' -.-> ')
        .replace(/\s*==>\s*/g, ' ==> ');

      result.push(indent.repeat(currentIndent) + formatted);
    }

    return { formatted: result.join('\n'), success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { formatted: content, success: false, error: errorMessage };
  }
}

/**
 * Checks if content is valid Mermaid that can be formatted
 *
 * Returns true if the first line matches a known Mermaid diagram type
 */
export function canFormat(content: string): boolean {
  const firstLine = content.trim().split('\n')[0].toLowerCase();
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/i.test(firstLine);
}
