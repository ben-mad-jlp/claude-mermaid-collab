/**
 * Diagram Utils Tests
 *
 * Tests verify:
 * - detectDirection function for extracting diagram direction from content
 * - toggleDirection function for swapping diagram direction
 * - Support for graph, flowchart, and wireframe diagram types
 * - Proper handling of all direction pairs (LR<->TD, RL<->BT)
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import { detectDirection, toggleDirection, type DiagramDirection } from '../diagramUtils';

describe('diagramUtils', () => {
  describe('detectDirection', () => {
    describe('graph diagrams', () => {
      it('should detect LR direction in graph', () => {
        const content = 'graph LR\n  A --> B';
        expect(detectDirection(content)).toBe('LR');
      });

      it('should detect TD direction in graph', () => {
        const content = 'graph TD\n  A --> B';
        expect(detectDirection(content)).toBe('TD');
      });

      it('should detect RL direction in graph', () => {
        const content = 'graph RL\n  A --> B';
        expect(detectDirection(content)).toBe('RL');
      });

      it('should detect BT direction in graph', () => {
        const content = 'graph BT\n  A --> B';
        expect(detectDirection(content)).toBe('BT');
      });
    });

    describe('flowchart diagrams', () => {
      it('should detect LR direction in flowchart', () => {
        const content = 'flowchart LR\n  A[Start] --> B[End]';
        expect(detectDirection(content)).toBe('LR');
      });

      it('should detect TD direction in flowchart', () => {
        const content = 'flowchart TD\n  A[Start] --> B[End]';
        expect(detectDirection(content)).toBe('TD');
      });
    });

    describe('wireframe diagrams', () => {
      it('should detect LR direction in wireframe', () => {
        const content = 'wireframe mobile LR\n  screen';
        expect(detectDirection(content)).toBe('LR');
      });

      it('should detect TD direction in wireframe', () => {
        const content = 'wireframe mobile TD\n  screen';
        expect(detectDirection(content)).toBe('TD');
      });

      it('should detect direction in wireframe with different device names', () => {
        const content = 'wireframe desktop RL\n  screen';
        expect(detectDirection(content)).toBe('RL');
      });
    });

    describe('edge cases', () => {
      it('should return null when no direction is found', () => {
        const content = 'graph\n  A --> B';
        expect(detectDirection(content)).toBeNull();
      });

      it('should return null for empty content', () => {
        expect(detectDirection('')).toBeNull();
      });

      it('should return null for content without diagram declaration', () => {
        const content = 'A --> B\nB --> C';
        expect(detectDirection(content)).toBeNull();
      });

      it('should handle whitespace before diagram declaration', () => {
        const content = '  \ngraph LR\n  A --> B';
        expect(detectDirection(content)).toBe('LR');
      });

      it('should be case insensitive for diagram type', () => {
        const content = 'GRAPH LR\n  A --> B';
        expect(detectDirection(content)).toBe('LR');
      });

      it('should handle direction on first line only', () => {
        const content = 'graph LR\nA --> B\ngraph TD\nC --> D';
        // Should detect the first one
        expect(detectDirection(content)).toBe('LR');
      });

      it('should ignore direction in subgraphs', () => {
        const content = 'graph LR\n  A --> B\n  subgraph S[sub]\n    C TD --> D\n  end';
        expect(detectDirection(content)).toBe('LR');
      });
    });
  });

  describe('toggleDirection', () => {
    describe('LR <-> TD toggling', () => {
      it('should toggle LR to TD', () => {
        const content = 'graph LR\n  A --> B';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('LR');
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('graph TD');
        expect(result.content).toContain('A --> B');
      });

      it('should toggle TD to LR', () => {
        const content = 'graph TD\n  A --> B';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('TD');
        expect(result.newDirection).toBe('LR');
        expect(result.content).toContain('graph LR');
        expect(result.content).toContain('A --> B');
      });

      it('should toggle in flowchart LR to TD', () => {
        const content = 'flowchart LR\n  A[Start] --> B[End]';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('LR');
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('flowchart TD');
      });

      it('should toggle in flowchart TD to LR', () => {
        const content = 'flowchart TD\n  A[Start] --> B[End]';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('TD');
        expect(result.newDirection).toBe('LR');
        expect(result.content).toContain('flowchart LR');
      });
    });

    describe('RL <-> BT toggling', () => {
      it('should toggle RL to BT', () => {
        const content = 'graph RL\n  A --> B';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('RL');
        expect(result.newDirection).toBe('BT');
        expect(result.content).toContain('graph BT');
      });

      it('should toggle BT to RL', () => {
        const content = 'graph BT\n  A --> B';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('BT');
        expect(result.newDirection).toBe('RL');
        expect(result.content).toContain('graph RL');
      });
    });

    describe('wireframe diagrams', () => {
      it('should toggle wireframe mobile LR to TD', () => {
        const content = 'wireframe mobile LR\n  screen: Main';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('LR');
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('wireframe mobile TD');
      });

      it('should toggle wireframe desktop TD to LR', () => {
        const content = 'wireframe desktop TD\n  screen: Detail';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('TD');
        expect(result.newDirection).toBe('LR');
        expect(result.content).toContain('wireframe desktop LR');
      });

      it('should preserve wireframe device name', () => {
        const content = 'wireframe tablet RL\n  screen';
        const result = toggleDirection(content);

        expect(result.content).toContain('wireframe tablet BT');
      });
    });

    describe('default direction handling', () => {
      it('should default to TD when no direction is found', () => {
        const content = 'graph\n  A --> B';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBeNull();
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('graph TD');
      });

      it('should insert direction after graph keyword when missing', () => {
        const content = 'graph\n  X --> Y\n  Y --> Z';
        const result = toggleDirection(content);

        expect(result.content).toMatch(/^graph TD/);
      });

      it('should insert direction after flowchart keyword when missing', () => {
        const content = 'flowchart\n  A --> B';
        const result = toggleDirection(content);

        expect(result.content).toMatch(/^flowchart TD/);
      });
    });

    describe('edge cases', () => {
      it('should handle multiline content', () => {
        const content = `graph LR
  A[Node A]
  B[Node B]
  A --> B`;
        const result = toggleDirection(content);

        expect(result.oldDirection).toBe('LR');
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('graph TD');
        expect(result.content).toContain('A[Node A]');
        expect(result.content).toContain('B[Node B]');
      });

      it('should preserve diagram content after toggle', () => {
        const content = `graph TD
  A[Start]
  B{Decision}
  C[Process]
  D[End]
  A --> B
  B -->|yes| C
  B -->|no| D
  C --> D`;
        const result = toggleDirection(content);

        expect(result.content).toContain('A[Start]');
        expect(result.content).toContain('B{Decision}');
        expect(result.content).toContain('C[Process]');
        expect(result.content).toContain('D[End]');
        expect(result.content).toContain('-->|yes|');
        expect(result.content).toContain('-->|no|');
      });

      it('should only replace direction in first diagram declaration', () => {
        const content = `graph LR
  A --> B
  subgraph S
    C --> D
  end`;
        const result = toggleDirection(content);

        expect(result.content).toMatch(/^graph TD/);
        // Should not modify content inside subgraph
        expect(result.content).toContain('C --> D');
      });

      it('should handle content with comments', () => {
        const content = `graph LR
%% This is a comment
  A --> B`;
        const result = toggleDirection(content);

        expect(result.content).toContain('graph TD');
        expect(result.content).toContain('%% This is a comment');
      });

      it('should handle empty content gracefully', () => {
        const content = '';
        const result = toggleDirection(content);

        expect(result.oldDirection).toBeNull();
        expect(result.newDirection).toBe('TD');
      });

      it('should preserve extra whitespace in content', () => {
        const content = 'graph LR\n  A --> B\n\n  B --> C';
        const result = toggleDirection(content);

        expect(result.content).toContain('graph TD');
        // Original structure should be mostly preserved
        expect(result.content).toContain('A --> B');
        expect(result.content).toContain('B --> C');
      });
    });

    describe('idempotency and cycling', () => {
      it('should cycle LR -> TD -> LR', () => {
        const content = 'graph LR\n  A --> B';
        const result1 = toggleDirection(content);
        const result2 = toggleDirection(result1.content);

        expect(result1.newDirection).toBe('TD');
        expect(result2.newDirection).toBe('LR');
        expect(result2.content).toContain('graph LR');
      });

      it('should cycle RL -> BT -> RL', () => {
        const content = 'graph RL\n  A --> B';
        const result1 = toggleDirection(content);
        const result2 = toggleDirection(result1.content);

        expect(result1.newDirection).toBe('BT');
        expect(result2.newDirection).toBe('RL');
        expect(result2.content).toContain('graph RL');
      });

      it('should cycle default -> TD -> LR -> TD', () => {
        const content = 'graph\n  A --> B';
        const result1 = toggleDirection(content);
        const result2 = toggleDirection(result1.content);
        const result3 = toggleDirection(result2.content);

        expect(result1.newDirection).toBe('TD');
        expect(result2.newDirection).toBe('LR');
        expect(result3.newDirection).toBe('TD');
      });
    });

    describe('case handling', () => {
      it('should handle case-insensitive graph keyword', () => {
        const content = 'GRAPH LR\n  A --> B';
        const result = toggleDirection(content);

        // Should preserve case
        expect(result.content).toContain('GRAPH TD');
      });

      it('should handle lowercase graph keyword', () => {
        const content = 'graph lr\n  A --> B';
        const result = toggleDirection(content);

        // Direction should be uppercase after toggle
        expect(result.newDirection).toBe('TD');
        expect(result.content).toContain('graph td');
      });
    });
  });

  describe('integration tests', () => {
    it('should correctly detect, then toggle, then detect again', () => {
      const content = 'graph LR\n  A --> B';

      const detected1 = detectDirection(content);
      expect(detected1).toBe('LR');

      const toggled = toggleDirection(content);
      expect(toggled.newDirection).toBe('TD');

      const detected2 = detectDirection(toggled.content);
      expect(detected2).toBe('TD');
    });

    it('should handle complex real-world flowchart', () => {
      const content = `flowchart LR
  A[User Input]
  B{Valid?}
  C[Process]
  D[Error]
  E[Result]

  A --> B
  B -->|Yes| C
  B -->|No| D
  C --> E
  D --> E`;

      const detected = detectDirection(content);
      expect(detected).toBe('LR');

      const toggled = toggleDirection(content);
      expect(toggled.oldDirection).toBe('LR');
      expect(toggled.newDirection).toBe('TD');
      expect(toggled.content).toContain('flowchart TD');

      // Verify all nodes are preserved
      expect(toggled.content).toContain('A[User Input]');
      expect(toggled.content).toContain('B{Valid?}');
      expect(toggled.content).toContain('|Yes|');
      expect(toggled.content).toContain('|No|');
    });
  });
});
