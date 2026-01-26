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

import { describe, it, expect, vi } from 'vitest';
import {
  detectDirection,
  toggleDirection,
  extractNodeId,
  extractEdgeInfo,
  findNodeLine,
  findEdgeLine,
  generateNodeId,
  buildNodeDefinition,
  buildNodeStyle,
  NODE_TYPES,
  type DiagramDirection,
  type NodeType,
} from '../diagramUtils';

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

  describe('NODE_TYPES', () => {
    it('should have terminal type with stadium shape', () => {
      expect(NODE_TYPES.terminal).toEqual({
        name: 'terminal',
        shape: { open: '([', close: '])' },
        style: 'fill:#c8e6c9,stroke:#2e7d32',
      });
    });

    it('should have state type with circle shape', () => {
      expect(NODE_TYPES.state).toEqual({
        name: 'state',
        shape: { open: '((', close: '))' },
        style: 'fill:#bbdefb,stroke:#1976d2',
      });
    });

    it('should have decision type with diamond shape', () => {
      expect(NODE_TYPES.decision).toEqual({
        name: 'decision',
        shape: { open: '{', close: '}' },
        style: 'fill:#fff9c4,stroke:#f9a825',
      });
    });

    it('should have action type with rectangle shape', () => {
      expect(NODE_TYPES.action).toEqual({
        name: 'action',
        shape: { open: '[', close: ']' },
        style: 'fill:#ffe0b2,stroke:#f57c00',
      });
    });
  });

  describe('extractNodeId', () => {
    it('should extract node ID from data-id attribute', () => {
      const element = document.createElement('div');
      element.setAttribute('data-id', 'NodeA');

      expect(extractNodeId(element)).toBe('NodeA');
    });

    it('should walk up tree to find data-id', () => {
      const parent = document.createElement('div');
      parent.setAttribute('data-id', 'ParentNode');
      const child = document.createElement('span');
      parent.appendChild(child);

      expect(extractNodeId(child)).toBe('ParentNode');
    });

    it('should extract node ID from older Mermaid id format', () => {
      const element = document.createElement('g');
      element.setAttribute('id', 'flowchart-Start-123');

      expect(extractNodeId(element)).toBe('Start');
    });

    it('should extract node ID with hyphen from older format', () => {
      const element = document.createElement('g');
      element.setAttribute('id', 'flowchart-node-1-456');

      expect(extractNodeId(element)).toBe('node');
    });

    it('should prefer data-id over id attribute', () => {
      const element = document.createElement('div');
      element.setAttribute('data-id', 'DataIdNode');
      element.setAttribute('id', 'flowchart-IdNode-123');

      expect(extractNodeId(element)).toBe('DataIdNode');
    });

    it('should return null when no node ID found', () => {
      const element = document.createElement('div');
      element.setAttribute('id', 'some-random-id');

      expect(extractNodeId(element)).toBeNull();
    });

    it('should return null for element without relevant attributes', () => {
      const element = document.createElement('div');

      expect(extractNodeId(element)).toBeNull();
    });
  });

  describe('extractEdgeInfo', () => {
    it('should extract edge info from edgePath element with L-format', () => {
      const element = document.createElement('path');
      element.classList.add('edgePath');
      element.setAttribute('id', 'L-NodeA-NodeB');

      expect(extractEdgeInfo(element)).toEqual({
        source: 'NodeA',
        target: 'NodeB',
      });
    });

    it('should extract edge info from parent edgePath', () => {
      const parent = document.createElement('g');
      parent.classList.add('edgePath');
      parent.setAttribute('id', 'L-Start-End');
      const child = document.createElement('path');
      parent.appendChild(child);

      expect(extractEdgeInfo(child)).toEqual({
        source: 'Start',
        target: 'End',
      });
    });

    it('should extract edge info from data-id attribute', () => {
      const element = document.createElement('g');
      element.classList.add('edgePath');
      element.setAttribute('data-id', 'L-A-B');

      expect(extractEdgeInfo(element)).toEqual({
        source: 'A',
        target: 'B',
      });
    });

    it('should handle non-L prefix format', () => {
      const element = document.createElement('g');
      element.classList.add('edgePath');
      element.setAttribute('id', 'NodeX-NodeY');

      expect(extractEdgeInfo(element)).toEqual({
        source: 'NodeX',
        target: 'NodeY',
      });
    });

    it('should return null when not in edgePath', () => {
      const element = document.createElement('path');
      element.setAttribute('id', 'L-A-B');

      expect(extractEdgeInfo(element)).toBeNull();
    });

    it('should return null for edgePath without valid id', () => {
      const element = document.createElement('g');
      element.classList.add('edgePath');

      expect(extractEdgeInfo(element)).toBeNull();
    });
  });

  describe('findNodeLine', () => {
    const content = `graph LR
  Start[Start Here]
  Process[Do Something]
  End[Finish]
  Start --> Process
  Process --> End`;

    it('should find node definition line', () => {
      expect(findNodeLine('Start', content)).toBe(2);
    });

    it('should find second node definition', () => {
      expect(findNodeLine('Process', content)).toBe(3);
    });

    it('should find third node definition', () => {
      expect(findNodeLine('End', content)).toBe(4);
    });

    it('should return null for non-existent node', () => {
      expect(findNodeLine('NonExistent', content)).toBeNull();
    });

    it('should handle node with special regex characters', () => {
      const specialContent = 'graph LR\n  Node.1[Label]';
      expect(findNodeLine('Node.1', specialContent)).toBe(2);
    });

    it('should handle nodes with parentheses shape', () => {
      const circleContent = 'graph LR\n  State((Circle))';
      expect(findNodeLine('State', circleContent)).toBe(2);
    });

    it('should handle nodes with curly brace shape', () => {
      const diamondContent = 'graph LR\n  Decision{Question}';
      expect(findNodeLine('Decision', diamondContent)).toBe(2);
    });
  });

  describe('findEdgeLine', () => {
    const content = `graph LR
  A[Start]
  B[Middle]
  C[End]
  A --> B
  B --> C
  A ---|label|> C`;

    it('should find edge line with arrow', () => {
      expect(findEdgeLine('A', 'B', content)).toBe(5);
    });

    it('should find second edge line', () => {
      expect(findEdgeLine('B', 'C', content)).toBe(6);
    });

    it('should find edge with label', () => {
      expect(findEdgeLine('A', 'C', content)).toBe(7);
    });

    it('should return null for non-existent edge', () => {
      expect(findEdgeLine('C', 'A', content)).toBeNull();
    });

    it('should handle special regex characters in node names', () => {
      const specialContent = 'graph LR\n  Node.1 --> Node.2';
      expect(findEdgeLine('Node.1', 'Node.2', specialContent)).toBe(2);
    });

    it('should handle double arrow', () => {
      const doubleArrow = 'graph LR\n  X ==> Y';
      expect(findEdgeLine('X', 'Y', doubleArrow)).toBe(2);
    });
  });

  describe('generateNodeId', () => {
    it('should generate node1 for empty content', () => {
      expect(generateNodeId('')).toBe('node1');
    });

    it('should generate next available ID', () => {
      const content = 'graph LR\n  node1[First]\n  node2[Second]';
      expect(generateNodeId(content)).toBe('node3');
    });

    it('should use custom prefix', () => {
      const content = 'graph LR\n  step1[First]';
      expect(generateNodeId(content, 'step')).toBe('step2');
    });

    it('should skip to next available when gap exists', () => {
      const content = 'graph LR\n  node1[A]\n  node3[B]';
      expect(generateNodeId(content)).toBe('node2');
    });

    it('should handle multiple node types', () => {
      const content = 'graph LR\n  action1[A]\n  state1((S))\n  decision1{D}';
      expect(generateNodeId(content, 'action')).toBe('action2');
      expect(generateNodeId(content, 'state')).toBe('state2');
      expect(generateNodeId(content, 'decision')).toBe('decision2');
    });

    it('should handle content without nodes', () => {
      const content = 'graph LR\n%% just a comment';
      expect(generateNodeId(content)).toBe('node1');
    });
  });

  describe('buildNodeDefinition', () => {
    it('should build terminal node definition', () => {
      expect(buildNodeDefinition('Start', 'Begin Process', 'terminal')).toBe(
        'Start(["Begin Process"])'
      );
    });

    it('should build state node definition', () => {
      expect(buildNodeDefinition('Waiting', 'Wait State', 'state')).toBe(
        'Waiting(("Wait State"))'
      );
    });

    it('should build decision node definition', () => {
      expect(buildNodeDefinition('Check', 'Is Valid?', 'decision')).toBe(
        'Check{"Is Valid?"}'
      );
    });

    it('should build action node definition', () => {
      expect(buildNodeDefinition('DoIt', 'Execute Task', 'action')).toBe(
        'DoIt["Execute Task"]'
      );
    });

    it('should handle empty label', () => {
      expect(buildNodeDefinition('Empty', '', 'action')).toBe('Empty[""]');
    });

    it('should handle label with quotes', () => {
      expect(buildNodeDefinition('Quote', 'Say "Hello"', 'action')).toBe(
        'Quote["Say "Hello""]'
      );
    });
  });

  describe('buildNodeStyle', () => {
    it('should build terminal style', () => {
      expect(buildNodeStyle('Start', 'terminal')).toBe(
        'style Start fill:#c8e6c9,stroke:#2e7d32'
      );
    });

    it('should build state style', () => {
      expect(buildNodeStyle('State1', 'state')).toBe(
        'style State1 fill:#bbdefb,stroke:#1976d2'
      );
    });

    it('should build decision style', () => {
      expect(buildNodeStyle('Check', 'decision')).toBe(
        'style Check fill:#fff9c4,stroke:#f9a825'
      );
    });

    it('should build action style', () => {
      expect(buildNodeStyle('DoTask', 'action')).toBe(
        'style DoTask fill:#ffe0b2,stroke:#f57c00'
      );
    });
  });
});
