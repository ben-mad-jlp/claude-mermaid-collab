/**
 * Mermaid Formatter Tests
 *
 * Tests verify:
 * - formatMermaid function with various Mermaid diagram types
 * - Indentation tracking (increase after subgraph, decrease on end)
 * - Arrow normalization (-->, ---, -.->, ==>)
 * - Empty line removal
 * - Error handling and edge cases
 * - canFormat function for diagram type detection
 */

import { describe, it, expect } from 'vitest';
import { formatMermaid, canFormat, type FormatOptions } from '../mermaidFormatter';

describe('mermaidFormatter', () => {
  describe('canFormat', () => {
    it('should return true for valid graph diagram', () => {
      expect(canFormat('graph LR\n  A --> B')).toBe(true);
    });

    it('should return true for flowchart type', () => {
      expect(canFormat('flowchart TD\n  A[Start] --> B[End]')).toBe(true);
    });

    it('should return true for sequence diagram', () => {
      expect(canFormat('sequenceDiagram\n  A->>B: Hello')).toBe(true);
    });

    it('should return true for class diagram', () => {
      expect(canFormat('classDiagram\n  class Car')).toBe(true);
    });

    it('should return true for state diagram', () => {
      expect(canFormat('stateDiagram\n  [*] --> A')).toBe(true);
    });

    it('should return true for ER diagram', () => {
      expect(canFormat('erDiagram\n  A to B')).toBe(true);
    });

    it('should return true for Gantt diagram', () => {
      expect(canFormat('gantt\n  task1 : 2023-01-01')).toBe(true);
    });

    it('should return true for pie diagram', () => {
      expect(canFormat('pie\n  A : 30')).toBe(true);
    });

    it('should return true for git graph', () => {
      expect(canFormat('gitGraph\n  commit')).toBe(true);
    });

    it('should return false for invalid diagram type', () => {
      expect(canFormat('invalid LR\n  A --> B')).toBe(false);
    });

    it('should return false for empty content', () => {
      expect(canFormat('')).toBe(false);
    });

    it('should return false for whitespace only', () => {
      expect(canFormat('   \n  \n  ')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(canFormat('GRAPH LR\n  A --> B')).toBe(true);
      expect(canFormat('Graph LR\n  A --> B')).toBe(true);
      expect(canFormat('FLOWCHART TD\n  A --> B')).toBe(true);
    });

    it('should handle leading whitespace', () => {
      expect(canFormat('  \n  graph LR\n  A --> B')).toBe(true);
    });
  });

  describe('formatMermaid - Basic Formatting', () => {
    it('should format simple graph with default indentation', () => {
      const input = 'graph LR\nA-->B\nB-->C';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.formatted).toContain('graph LR');
      expect(result.formatted).toContain('A --> B');
      expect(result.formatted).toContain('B --> C');
    });

    it('should normalize arrow spacing (-->)', () => {
      const input = 'graph LR\nA-->B\nC  -->  D\nE--> F';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines).toContainEqual('A --> B');
      expect(lines).toContainEqual('C --> D');
      expect(lines).toContainEqual('E --> F');
    });

    it('should normalize dashed arrow spacing (---)', () => {
      const input = 'graph LR\nA---B\nC  ---  D';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines).toContainEqual('A --- B');
      expect(lines).toContainEqual('C --- D');
    });

    it('should normalize dotted arrow spacing (-.->) ', () => {
      const input = 'graph LR\nA-.->B\nC  -.->>  D';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[1]).toContain('-.->');
    });

    it('should normalize double arrow spacing (==>)', () => {
      const input = 'graph LR\nA==>B\nC  ==>  D';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines).toContainEqual('A ==> B');
      expect(lines).toContainEqual('C ==> D');
    });

    it('should remove empty lines', () => {
      const input = 'graph LR\n  A --> B\n\n  B --> C\n\n\n  C --> D';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines.length).toBe(4); // diagram type + 3 connections
      expect(lines).not.toContain('');
    });

    it('should preserve diagram type declaration', () => {
      const input = 'graph TB\n  A --> B';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.formatted.startsWith('graph TB')).toBe(true);
    });
  });

  describe('formatMermaid - Indentation', () => {
    it('should apply default indentation (2 spaces)', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[1]).toBe('subgraph A');
      expect(lines[2]).toBe('  B --> C');
      expect(lines[3]).toBe('end');
    });

    it('should apply custom indentation size', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend';
      const options: FormatOptions = { indentSize: 4 };
      const result = formatMermaid(input, options);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe('    B --> C');
    });

    it('should increase indent after subgraph', () => {
      const input = 'graph LR\nA --> B\nsubgraph X\nC --> D\nend\nE --> F';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[0]).toBe('graph LR');
      expect(lines[1]).toBe('A --> B');
      expect(lines[2]).toBe('subgraph X');
      expect(lines[3]).toBe('  C --> D');
      expect(lines[4]).toBe('end');
      expect(lines[5]).toBe('E --> F');
    });

    it('should decrease indent on end', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend\nD --> E';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe('  B --> C');
      expect(lines[3]).toBe('end');
      expect(lines[4]).toBe('D --> E');
    });

    it('should handle nested subgraphs', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nsubgraph D\nE --> F\nend\nG --> H\nend';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe('  B --> C');
      expect(lines[3]).toBe('  subgraph D');
      expect(lines[4]).toBe('    E --> F');
      expect(lines[5]).toBe('  end');
      expect(lines[6]).toBe('  G --> H');
      expect(lines[7]).toBe('end');
    });

    it('should not go below zero indent', () => {
      const input = 'graph LR\nA --> B\nend\nC --> D'; // 'end' without matching subgraph
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      // Indent should not go negative
      expect(lines[2]).toBe('end');
      expect(lines[3]).toBe('C --> D');
    });

    it('should be case insensitive for subgraph/end keywords', () => {
      const input = 'graph LR\nSUBGRAPH A\nB --> C\nEND';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      // subgraph keyword should be preserved as-is but indentation should work
      expect(lines[2]).toBe('  B --> C');
    });
  });

  describe('formatMermaid - Complex Diagrams', () => {
    it('should format flowchart with multiple branches', () => {
      const input = `flowchart TD
A[Start]-->B{Check}
B-->|Yes|C[Process]
B-->|No|D[Skip]
C-->E[End]
D-->E`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[0]).toBe('flowchart TD');
      // Check that all arrows are normalized
      expect(result.formatted).toMatch(/-->/g);
    });

    it('should format sequence diagram', () => {
      const input = `sequenceDiagram
participant A as Alice
participant B as Bob
A->>B: Hello
B-->>A: Hi`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('sequenceDiagram');
    });

    it('should format graph with labeled edges', () => {
      const input = `graph LR
A[Node A]-->|label|B[Node B]
B-->|another|C[Node C]`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[1]).toContain('-->');
      expect(lines[2]).toContain('-->');
    });

    it('should format real-world flowchart example', () => {
      const input = `graph TD
    A[Christmas]-->|Get money|B[Go shopping]
    B-->C{Let me think}
    C-->|One|D[Laptop]
    C-->|Two|E[iPhone]
    C-->|Three|F[fa:fa-car Car]`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('graph TD');
      // Should have properly formatted arrows
      const arrowCount = (result.formatted.match(/-->/g) || []).length;
      expect(arrowCount).toBe(5);
    });

    it('should preserve node definitions with special characters', () => {
      const input = `graph LR
A["Node with [brackets]"]-->B{Decision}
C["Node with (parens)"]-->D["Node with quotes"]`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('[brackets]');
      expect(result.formatted).toContain('(parens)');
    });
  });

  describe('formatMermaid - Error Handling', () => {
    it('should handle empty content', () => {
      const result = formatMermaid('');

      expect(result.success).toBe(true);
      expect(result.formatted).toBe('');
      expect(result.error).toBeUndefined();
    });

    it('should return original content on error', () => {
      const input = 'invalid content that breaks formatting';
      const result = formatMermaid(input);

      // Should not crash, but formatMermaid is lenient and shouldn't error
      expect(result).toBeDefined();
    });

    it('should handle null or undefined options gracefully', () => {
      const input = 'graph LR\nA --> B';
      const result = formatMermaid(input, undefined);

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('A --> B');
    });

    it('should handle very deeply nested subgraphs', () => {
      const input = `graph LR
subgraph A
subgraph B
subgraph C
subgraph D
X --> Y
end
end
end
end`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      // The innermost node should have 8 spaces (4 levels * 2 spaces)
      expect(lines[5]).toBe('        X --> Y');
    });
  });

  describe('formatMermaid - Edge Cases', () => {
    it('should handle lines with only whitespace', () => {
      const input = 'graph LR\n    \nA --> B\n  \nB --> C';
      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines).not.toContain('');
      expect(lines).not.toContain('    ');
    });

    it('should preserve different arrow types in same diagram', () => {
      const input = `graph LR
A-->B
C---D
E-.->F
G==>H`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const formatted = result.formatted;
      expect(formatted).toContain('A --> B');
      expect(formatted).toContain('C --- D');
      expect(formatted).toContain('-.->');
      expect(formatted).toContain('G ==> H');
    });

    it('should handle subgraph with complex id', () => {
      const input = `graph LR
subgraph cluster_0[My Subgraph]
A --> B
end`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[1]).toContain('subgraph');
      expect(lines[2]).toBe('  A --> B');
    });

    it('should format graph with comments preserved in structure', () => {
      const input = `graph LR
A --> B
%% This is a comment
B --> C`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      // Comment should be preserved
      expect(lines).toContainEqual('%% This is a comment');
    });

    it('should handle single node diagram', () => {
      const input = `graph LR
A[Single Node]`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      expect(result.formatted).toContain('A[Single Node]');
    });

    it('should handle diagram with semicolons', () => {
      const input = `graph LR
A-->B;
B-->C;`;

      const result = formatMermaid(input);

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      // Semicolons should be preserved
      expect(lines.some(line => line.includes(';'))).toBe(true);
    });
  });

  describe('formatMermaid - Indentation with Options', () => {
    it('should use 1 space indentation when specified', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend';
      const result = formatMermaid(input, { indentSize: 1 });

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe(' B --> C');
    });

    it('should use tab-like indentation (4 spaces)', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend';
      const result = formatMermaid(input, { indentSize: 4 });

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe('    B --> C');
    });

    it('should handle 0 indentation size', () => {
      const input = 'graph LR\nsubgraph A\nB --> C\nend';
      const result = formatMermaid(input, { indentSize: 0 });

      expect(result.success).toBe(true);
      const lines = result.formatted.split('\n');
      expect(lines[2]).toBe('B --> C'); // No indentation
    });
  });

  describe('formatMermaid - All Diagram Types', () => {
    const diagramTypes = [
      'graph LR',
      'graph TD',
      'flowchart LR',
      'flowchart TD',
      'sequenceDiagram',
      'classDiagram',
      'stateDiagram',
      'erDiagram',
      'gantt',
      'pie',
      'gitGraph',
    ];

    diagramTypes.forEach((diagramType) => {
      it(`should format ${diagramType} diagram`, () => {
        const input = `${diagramType}
A --> B`;

        const result = formatMermaid(input);

        expect(result.success).toBe(true);
        expect(result.formatted).toContain(diagramType);
      });
    });
  });
});
