/**
 * Diagrams Tab - Client-side mermaid rendering for topic detail
 */

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { DiagramBlock } from '@/lib/onboarding-api';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

interface Props {
  diagrams: DiagramBlock[];
}

export const DiagramsTab: React.FC<Props> = ({ diagrams }) => {
  if (diagrams.length === 0) {
    return (
      <div className="text-gray-400 text-sm py-8 text-center">
        No diagrams available for this topic.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {diagrams.map((diagram, i) => (
        <MermaidDiagram key={i} diagram={diagram} index={i} />
      ))}
    </div>
  );
};

const MermaidDiagram: React.FC<{ diagram: DiagramBlock; index: number }> = ({ diagram, index }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !diagram.content.trim()) return;

    const id = `onboarding-diagram-${index}-${Date.now()}`;

    mermaid.render(id, diagram.content)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(err => {
        setError(err.message || 'Failed to render diagram');
      });
  }, [diagram.content, index]);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {diagram.title && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium">{diagram.title}</h4>
        </div>
      )}
      <div className="p-4 overflow-auto">
        {error ? (
          <div className="text-red-500 text-sm">
            <p>Failed to render diagram:</p>
            <pre className="mt-1 text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded">{error}</pre>
            <details className="mt-2">
              <summary className="text-xs cursor-pointer">Source</summary>
              <pre className="mt-1 text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto">
                {diagram.content}
              </pre>
            </details>
          </div>
        ) : (
          <div ref={containerRef} className="flex justify-center" />
        )}
      </div>
    </div>
  );
};
