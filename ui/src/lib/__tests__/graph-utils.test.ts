import {
  parseRelatedTopics,
  buildGraphEdges,
  generateMermaidGraph,
  GraphEdge,
} from '../graph-utils';

describe('graph-utils', () => {
  describe('parseRelatedTopics', () => {
    it('should extract topic names from backtick-wrapped format', () => {
      const related = '- `mcp-server` - MCP tools for Kodex\n- `services` - KodexManager service';
      const result = parseRelatedTopics(related);
      expect(result).toEqual(['mcp-server', 'services']);
    });

    it('should return empty array for empty string', () => {
      const result = parseRelatedTopics('');
      expect(result).toEqual([]);
    });

    it('should return empty array when no backticks present', () => {
      const related = 'No topics mentioned here';
      const result = parseRelatedTopics(related);
      expect(result).toEqual([]);
    });

    it('should handle multiple references to same topic', () => {
      const related = '- `topic-a` first mention\n- `topic-a` second mention';
      const result = parseRelatedTopics(related);
      // Should return unique values only
      expect(result).toEqual(['topic-a']);
    });

    it('should extract single topic', () => {
      const related = 'See also: `authentication`';
      const result = parseRelatedTopics(related);
      expect(result).toEqual(['authentication']);
    });

    it('should handle malformed markdown gracefully', () => {
      const related = 'Some text `topic-1` more text `topic-2` and `topic-3`';
      const result = parseRelatedTopics(related);
      expect(result).toEqual(['topic-1', 'topic-2', 'topic-3']);
    });

    it('should not match backticks with spaces inside', () => {
      const related = '`topic name` and `valid-topic`';
      const result = parseRelatedTopics(related);
      // Only valid-topic should match (topic name has space)
      expect(result).toContain('valid-topic');
      expect(result.length).toBe(1);
    });

    it('should not match uppercase topic names', () => {
      const related = '- `Topic-A` and `topic-a`';
      const result = parseRelatedTopics(related);
      // Only lowercase matches the pattern [a-z0-9-]+
      expect(result).toEqual(['topic-a']);
    });

    it('should handle special characters in topic names', () => {
      const related = '- `auth-service` and `api_v2`';
      const result = parseRelatedTopics(related);
      expect(result).toContain('auth-service');
    });
  });

  describe('buildGraphEdges', () => {
    it('should build edges from topics with relationships', () => {
      const topics = [
        { name: 'auth', related: '- `services`\n- `config`' },
        { name: 'services', related: '- `auth`' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toContainEqual({ source: 'auth', target: 'services' });
      expect(edges).toContainEqual({ source: 'auth', target: 'config' });
      expect(edges).toContainEqual({ source: 'services', target: 'auth' });
      expect(edges).toHaveLength(3);
    });

    it('should skip topics without related field', () => {
      const topics = [
        { name: 'topic-a', related: '- `topic-b`' },
        { name: 'topic-c' }, // No related field
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toEqual([{ source: 'topic-a', target: 'topic-b' }]);
    });

    it('should handle empty related field', () => {
      const topics = [
        { name: 'topic-a', related: '' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toEqual([]);
    });

    it('should handle self-referencing topics', () => {
      const topics = [
        { name: 'topic-a', related: '- `topic-a`' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toContainEqual({ source: 'topic-a', target: 'topic-a' });
    });

    it('should handle circular references', () => {
      const topics = [
        { name: 'topic-a', related: '- `topic-b`' },
        { name: 'topic-b', related: '- `topic-a`' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toContainEqual({ source: 'topic-a', target: 'topic-b' });
      expect(edges).toContainEqual({ source: 'topic-b', target: 'topic-a' });
    });

    it('should include edges for non-existent referenced topics', () => {
      const topics = [
        { name: 'topic-a', related: '- `non-existent`' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toContainEqual({ source: 'topic-a', target: 'non-existent' });
    });

    it('should handle multiple topics with multiple relations', () => {
      const topics = [
        { name: 'auth', related: '- `mcp-server`\n- `services`' },
        { name: 'config', related: '- `services`' },
        { name: 'services', related: '- `auth`\n- `config`' },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toHaveLength(5);
    });

    it('should handle undefined related field gracefully', () => {
      const topics = [
        { name: 'topic-a', related: '- `topic-b`' },
        { name: 'topic-c', related: undefined },
      ];
      const edges = buildGraphEdges(topics);

      expect(edges).toEqual([{ source: 'topic-a', target: 'topic-b' }]);
    });
  });

  describe('generateMermaidGraph', () => {
    it('should generate valid Mermaid syntax with nodes and edges', () => {
      const edges: GraphEdge[] = [
        { source: 'auth', target: 'services' },
        { source: 'services', target: 'config' },
      ];
      const topics = new Map([
        ['auth', { title: 'Authentication', name: 'auth' }],
        ['services', { title: 'Services', name: 'services' }],
        ['config', { title: 'Configuration', name: 'config' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('graph LR');
      expect(result).toContain('auth["Authentication"]');
      expect(result).toContain('services["Services"]');
      expect(result).toContain('config["Configuration"]');
      expect(result).toContain('auth --> services');
      expect(result).toContain('services --> config');
    });

    it('should return minimal valid Mermaid when no edges provided', () => {
      const edges: GraphEdge[] = [];
      const topics = new Map();

      const result = generateMermaidGraph(edges, topics);

      expect(result).toBe('graph LR');
    });

    it('should use topic name as fallback when title missing', () => {
      const edges: GraphEdge[] = [
        { source: 'auth', target: 'services' },
      ];
      const topics = new Map([
        ['auth', { title: 'Authentication', name: 'auth' }],
        ['services', { title: '', name: 'services' }], // Empty title
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('auth["Authentication"]');
      expect(result).toContain('services["services"]'); // Falls back to name
    });

    it('should handle dangling edges (target not in topics)', () => {
      const edges: GraphEdge[] = [
        { source: 'auth', target: 'nonexistent' },
      ];
      const topics = new Map([
        ['auth', { title: 'Authentication', name: 'auth' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('auth["Authentication"]');
      expect(result).toContain('nonexistent["nonexistent"]');
      expect(result).toContain('auth --> nonexistent');
    });

    it('should handle single node (single edge)', () => {
      const edges: GraphEdge[] = [
        { source: 'auth', target: 'services' },
      ];
      const topics = new Map([
        ['auth', { title: 'Auth', name: 'auth' }],
        ['services', { title: 'Services', name: 'services' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      const lines = result.split('\n');
      expect(lines[0]).toBe('graph LR');
      expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 nodes + edge
    });

    it('should format node labels with quotes properly', () => {
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b' },
      ];
      const topics = new Map([
        ['a', { title: 'Topic A', name: 'a' }],
        ['b', { title: 'Topic B', name: 'b' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('a["Topic A"]');
      expect(result).toContain('b["Topic B"]');
    });

    it('should handle long titles', () => {
      const edges: GraphEdge[] = [
        { source: 'auth', target: 'services' },
      ];
      const topics = new Map([
        ['auth', { title: 'Authentication and Authorization Service with OAuth2 Support', name: 'auth' }],
        ['services', { title: 'Core Services Layer', name: 'services' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('Authentication and Authorization Service with OAuth2 Support');
      expect(result).toContain('auth --> services');
    });

    it('should handle circular references', () => {
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ];
      const topics = new Map([
        ['a', { title: 'Topic A', name: 'a' }],
        ['b', { title: 'Topic B', name: 'b' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      expect(result).toContain('a --> b');
      expect(result).toContain('b --> a');
    });

    it('should handle topic referenced multiple times', () => {
      const edges: GraphEdge[] = [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ];
      const topics = new Map([
        ['a', { title: 'A', name: 'a' }],
        ['b', { title: 'B', name: 'b' }],
        ['c', { title: 'C', name: 'c' }],
      ]);

      const result = generateMermaidGraph(edges, topics);

      // Should only define node c once
      const nodeCount = (result.match(/c\["C"\]/g) || []).length;
      expect(nodeCount).toBe(1);

      // But have two edges pointing to it
      const edgeCount = (result.match(/ --> c$/gm) || []).length;
      expect(edgeCount).toBe(2);
    });
  });
});
