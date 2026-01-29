/**
 * Graph utility functions for parsing and generating Mermaid graph syntax
 * from Kodex topic relationships.
 */

export interface GraphEdge {
  source: string;  // topic name
  target: string;  // related topic name
}

export interface GraphNode {
  id: string;
  label: string;
  title?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Parse related topics from markdown text containing backtick-wrapped topic names.
 *
 * Matches patterns like `topic-name` and extracts the names.
 * Returns unique topic names only.
 *
 * @param relatedText - Markdown text containing related topics
 * @returns Array of unique topic names
 */
export function parseRelatedTopics(relatedText: string): string[] {
  // Step 1 - Validate input
  if (!relatedText || typeof relatedText !== 'string') {
    return [];
  }

  // Step 2 - Use regex to find backtick patterns
  const matches = relatedText.match(/`([a-z0-9-]+)`/g) || [];

  // Step 3 - Extract topic names from matches
  const topics = matches.map(m => m.replace(/`/g, ''));

  // Step 4 - Ensure unique values
  const uniqueTopics = Array.from(new Set(topics));

  // Step 5 - Return array
  return uniqueTopics;
}

/**
 * Build graph edges from an array of topics with their related field.
 *
 * Parses the related field of each topic to extract referenced topics
 * and creates edges (source -> target relationships).
 *
 * @param topics - Array of topics with name and optional related field
 * @returns Array of GraphEdge objects
 */
export function buildGraphEdges(
  topics: Array<{ name: string; related?: string }>
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Step 1 - Iterate over topics
  for (const topic of topics) {
    // Step 2 - Skip topics without related field
    if (!topic.related) {
      continue;
    }

    // Step 3 - Parse related field for topic names
    const relatedNames = parseRelatedTopics(topic.related);

    // Step 4 - Create edges for each reference
    for (const target of relatedNames) {
      edges.push({
        source: topic.name,
        target,
      });
    }
  }

  // Step 5 - Return edges array
  return edges;
}

/**
 * Generate Mermaid graph syntax from edges and topic metadata.
 *
 * Creates a left-to-right flowchart with nodes labeled by title
 * and edges connecting related topics.
 *
 * @param edges - Array of GraphEdge objects
 * @param topics - Map of topic name to {title, name}
 * @returns Mermaid graph syntax as string
 */
export function generateMermaidGraph(
  edges: GraphEdge[],
  topics: Map<string, { title: string; name: string }>
): string {
  const lines: string[] = ['graph LR'];

  // Step 1 - Collect connected nodes from edges
  const connectedNodes = new Set<string>();
  for (const edge of edges) {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  }

  // Step 2 - Define nodes with titles
  for (const name of connectedNodes) {
    const topic = topics.get(name);
    const label = topic?.title || name;
    lines.push(`    ${name}["${label}"]`);
  }

  // Step 3 - Define edges
  for (const edge of edges) {
    lines.push(`    ${edge.source} --> ${edge.target}`);
  }

  // Step 4 - Handle sanitization (no special chars to escape for basic topic names)
  // Step 5 - Join and return
  return lines.join('\n');
}
