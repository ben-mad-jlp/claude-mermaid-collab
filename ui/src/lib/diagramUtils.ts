/**
 * Diagram utility functions for Mermaid manipulation
 */

export type DiagramDirection = 'LR' | 'TD' | 'RL' | 'BT';

/**
 * Node type definition for Mermaid flowchart nodes
 */
export interface NodeType {
  name: 'terminal' | 'state' | 'decision' | 'action';
  shape: { open: string; close: string };
  style: string;
}

/**
 * Available node types with their shapes and styles
 */
export const NODE_TYPES: Record<string, NodeType> = {
  terminal: {
    name: 'terminal',
    shape: { open: '([', close: '])' },
    style: 'fill:#c8e6c9,stroke:#2e7d32',
  },
  state: {
    name: 'state',
    shape: { open: '((', close: '))' },
    style: 'fill:#bbdefb,stroke:#1976d2',
  },
  decision: {
    name: 'decision',
    shape: { open: '{', close: '}' },
    style: 'fill:#fff9c4,stroke:#f9a825',
  },
  action: {
    name: 'action',
    shape: { open: '[', close: ']' },
    style: 'fill:#ffe0b2,stroke:#f57c00',
  },
};

export interface ToggleDirectionResult {
  content: string;
  oldDirection: DiagramDirection | null;
  newDirection: DiagramDirection;
}

/**
 * Detect the current direction of a Mermaid diagram
 *
 * Matches patterns like:
 * - graph LR
 * - flowchart TD
 * - wireframe mobile LR
 */
export function detectDirection(content: string): DiagramDirection | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  // Match: (graph|flowchart|wireframe\s+\w+)\s+(LR|TD|RL|BT)
  // Use multiline flag to match from start of any line
  const regex = /^(graph|flowchart|wireframe\s+\w+)\s+(LR|TD|RL|BT)/mi;
  const match = content.match(regex);

  if (match && match[2]) {
    return match[2].toUpperCase() as DiagramDirection;
  }

  return null;
}

/**
 * Toggle diagram direction between LR/TD or RL/BT
 *
 * Toggling pairs:
 * - LR <-> TD
 * - RL <-> BT
 *
 * If no direction is found, defaults to adding TD
 */
export function toggleDirection(content: string): ToggleDirectionResult {
  if (!content || typeof content !== 'string') {
    return {
      content: '',
      oldDirection: null,
      newDirection: 'TD',
    };
  }

  // Detect current direction
  const oldDirection = detectDirection(content);

  // Determine new direction based on pairing
  let newDirection: DiagramDirection;
  if (oldDirection === 'LR') {
    newDirection = 'TD';
  } else if (oldDirection === 'TD') {
    newDirection = 'LR';
  } else if (oldDirection === 'RL') {
    newDirection = 'BT';
  } else if (oldDirection === 'BT') {
    newDirection = 'RL';
  } else {
    // No direction found, default to TD
    newDirection = 'TD';
  }

  // Replace direction in content
  let newContent: string;

  if (oldDirection) {
    // Replace existing direction
    // Match the diagram declaration and replace direction
    const regex = /^((?:graph|flowchart|wireframe\s+\w+)\s+)(LR|TD|RL|BT)/mi;
    newContent = content.replace(regex, (match, prefix) => {
      // Preserve case of original direction keyword when replacing
      const oldDirectionMatch = match.match(/(LR|TD|RL|BT)/i);
      if (oldDirectionMatch) {
        // Use the original case pattern
        const originalCase = oldDirectionMatch[1];
        const isLowerCase = originalCase === originalCase.toLowerCase();
        const resultDirection = isLowerCase ? newDirection.toLowerCase() : newDirection;
        return prefix + resultDirection;
      }
      return prefix + newDirection;
    });
  } else {
    // No existing direction, add it after diagram type
    const diagramRegex = /^((?:graph|flowchart|wireframe\s+\w+))(\s|$)/mi;
    const hasSpace = content.match(/^(?:graph|flowchart|wireframe\s+\w+)\s/mi);

    if (hasSpace) {
      // Has a space after diagram type, replace it with space + direction
      newContent = content.replace(
        /^((?:graph|flowchart|wireframe\s+\w+))\s/mi,
        `$1 ${newDirection}`
      );
    } else {
      // No space, add it
      newContent = content.replace(
        /^((?:graph|flowchart|wireframe\s+\w+))(\s|$)/mi,
        `$1 ${newDirection}$2`
      );
    }
  }

  return {
    content: newContent,
    oldDirection: oldDirection,
    newDirection: newDirection,
  };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract node ID from a DOM element by walking up the tree
 * Handles both newer Mermaid (data-id) and older format (flowchart-NodeId-123)
 *
 * @param element - The DOM element to extract node ID from
 * @returns The node ID or null if not found
 */
export function extractNodeId(element: Element): string | null {
  let current: Element | null = element;

  while (current) {
    // Check data-id first (newer Mermaid)
    const dataId = current.getAttribute('data-id');
    if (dataId) {
      return dataId;
    }

    // Check id attribute (older Mermaid format: flowchart-NodeId-123)
    const id = current.getAttribute('id');
    if (id && id.startsWith('flowchart-')) {
      const match = id.match(/flowchart-(.+?)-\d+/);
      if (match) {
        return match[1];
      }
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * Extract edge information from a DOM element by walking up to find edge container
 *
 * @param element - The DOM element to extract edge info from
 * @returns Object with source and target node IDs, or null if not found
 */
export function extractEdgeInfo(
  element: Element
): { source: string; target: string; label?: string } | null {
  let current: Element | null = element;

  while (current) {
    if (current.classList.contains('edgePath')) {
      // Edge ID format: L-NodeA-NodeB or similar
      const id = current.getAttribute('id') || current.getAttribute('data-id');
      if (id) {
        const match = id.match(/L-(.+?)-(.+?)$/) || id.match(/(.+?)-(.+?)$/);
        if (match) {
          return { source: match[1], target: match[2] };
        }
      }
    }

    current = current.parentElement;
  }

  return null;
}

/**
 * Find the line number where a node is defined in Mermaid content
 *
 * @param nodeId - The node ID to search for
 * @param content - The Mermaid diagram content
 * @returns 1-indexed line number or null if not found
 */
export function findNodeLine(nodeId: string, content: string): number | null {
  const lines = content.split('\n');
  // Pattern: NodeId followed by shape characters or connection arrow
  const pattern = new RegExp('^\\s*' + escapeRegex(nodeId) + '\\s*[\\[\\(\\{]');

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1; // 1-indexed
    }
  }

  return null;
}

/**
 * Find the line number where an edge is defined in Mermaid content
 *
 * @param source - Source node ID
 * @param target - Target node ID
 * @param content - The Mermaid diagram content
 * @returns 1-indexed line number or null if not found
 */
export function findEdgeLine(
  source: string,
  target: string,
  content: string
): number | null {
  const lines = content.split('\n');
  // Pattern: source --> target or source ---|label|> target
  const pattern = new RegExp(
    escapeRegex(source) + '\\s*[-=]+[>|].*' + escapeRegex(target)
  );

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1; // 1-indexed
    }
  }

  return null;
}

/**
 * Generate a unique node ID based on existing nodes in the content
 *
 * @param content - The Mermaid diagram content
 * @param prefix - Prefix for the node ID (default: 'node')
 * @returns A unique node ID
 */
export function generateNodeId(content: string, prefix: string = 'node'): string {
  // Find all existing node IDs
  const existingIds = new Set<string>();
  const pattern = /^\s*(\w+)\s*[\[\(\{]/gm;

  let match = pattern.exec(content);
  while (match) {
    existingIds.add(match[1]);
    match = pattern.exec(content);
  }

  // Generate unique ID
  let counter = 1;
  while (existingIds.has(prefix + counter)) {
    counter++;
  }

  return prefix + counter;
}

/**
 * Build a Mermaid node definition string
 *
 * @param id - The node ID
 * @param label - The node label text
 * @param type - The node type (terminal, state, decision, action)
 * @returns Mermaid node definition string
 */
export function buildNodeDefinition(
  id: string,
  label: string,
  type: NodeType['name']
): string {
  const nodeType = NODE_TYPES[type];
  return id + nodeType.shape.open + '"' + label + '"' + nodeType.shape.close;
}

/**
 * Build a Mermaid style statement for a node
 *
 * @param id - The node ID
 * @param type - The node type (terminal, state, decision, action)
 * @returns Mermaid style statement string
 */
export function buildNodeStyle(id: string, type: NodeType['name']): string {
  const nodeType = NODE_TYPES[type];
  return 'style ' + id + ' ' + nodeType.style;
}
