/**
 * Kodex Topic Graph Visualization
 *
 * Displays topics as nodes in a Mermaid graph with relationships as edges.
 * Clicking a node navigates to that topic's detail page.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kodexApi, type Topic } from '@/lib/kodex-api';
import { useKodexStore } from '@/stores/kodexStore';
import { buildGraphEdges, generateMermaidGraph } from '@/lib/graph-utils';
import { DiagramEmbed } from '@/components/ai-ui/mermaid';

export const Graph: React.FC = () => {
  const [mermaidSrc, setMermaidSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const selectedProject = useKodexStore((s) => s.selectedProject);

  useEffect(() => {
    if (!selectedProject) {
      setLoading(false);
      return;
    }

    const loadGraph = async () => {
      try {
        setLoading(true);
        setError(null);

        // Step 1 - Fetch all topics with content
        const topics = await kodexApi.listTopicsWithContent(selectedProject);

        // Step 2 - Build edges from related fields
        const topicData = topics.map((t) => ({
          name: t.name,
          related: t.content?.related || '',
        }));
        const edges = buildGraphEdges(topicData);

        // Step 3 - Generate Mermaid syntax
        const topicMap = new Map(
          topics.map((t) => [t.name, { title: t.title, name: t.name }])
        );
        const src = generateMermaidGraph(edges, topicMap);

        // Step 4 - Set state
        setMermaidSrc(src);
        setLoading(false);
      } catch (err) {
        // Step 5 - Handle errors
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to load graph';
        setError(errorMessage);
        setLoading(false);
      }
    };

    loadGraph();
  }, [selectedProject]);

  // Handle node clicks to navigate to topic detail
  const handleNodeClick = (nodeId: string) => {
    navigate(`/kodex/topics/${nodeId}`);
  };

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a project to view the graph</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Topic Graph</h1>

      {loading && (
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div style={{ height: '600px' }}>
          <DiagramEmbed content={mermaidSrc} onNodeClick={handleNodeClick} />
        </div>
      )}
    </div>
  );
};
