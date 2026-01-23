/**
 * Diagram utility functions for Mermaid manipulation
 */

export type DiagramDirection = 'LR' | 'TD' | 'RL' | 'BT';

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
