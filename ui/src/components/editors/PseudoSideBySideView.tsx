/**
 * PseudoSideBySideView Component
 *
 * Wraps a code editor (children, rendered on the left) alongside a PseudoViewer
 * (rendered on the right) using SplitPane. Before showing the viewer, it probes
 * for the presence of a corresponding .pseudo file for the given source file.
 *
 * If the .pseudo file does not exist, renders an empty state with instructions
 * to run the /pseudocode command.
 */

import React, { useEffect, useState } from 'react';
import { SplitPane } from '@/components/layout/SplitPane';
import { PseudoViewer } from '@/pages/pseudo/PseudoViewer';
import { fetchPseudoFile } from '@/lib/pseudo-api';

export interface PseudoSideBySideViewProps {
  /** Snippet id (reserved for future use, e.g. persistence keys) */
  snippetId: string;
  /** Absolute or project-relative path to the source file being edited */
  sourceFilePath: string;
  /** Absolute path to the project root */
  projectPath: string;
  /** The code editor content rendered on the left side */
  children: React.ReactNode;
}

/**
 * Derive the pseudo "stem" (relative path without extension) from the source
 * file path. The pseudo API (fetchPseudoFile / PseudoViewer.path) expects a
 * stem such as "src/lib/helper" — NOT a full path and NOT a ".pseudo" suffix.
 */
function deriveStem(sourceFilePath: string, projectPath: string): string {
  let rel = sourceFilePath;
  if (projectPath && rel.startsWith(projectPath)) {
    rel = rel.slice(projectPath.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
  }
  return rel.replace(/\.[^./]+$/, '');
}

export const PseudoSideBySideView: React.FC<PseudoSideBySideViewProps> = ({
  snippetId,
  sourceFilePath,
  projectPath,
  children,
}) => {
  const pseudoStem = deriveStem(sourceFilePath, projectPath);
  const pseudoDisplayPath = `${pseudoStem}.pseudo`;

  // null = checking, false = not found, true = exists
  const [pseudoExists, setPseudoExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPseudoExists(null);

    if (!projectPath || !pseudoStem) {
      setPseudoExists(false);
      return;
    }

    (async () => {
      try {
        await fetchPseudoFile(projectPath, pseudoStem);
        if (!cancelled) setPseudoExists(true);
      } catch {
        if (!cancelled) setPseudoExists(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath, pseudoStem]);

  let rightContent: React.ReactNode;
  if (pseudoExists === null) {
    rightContent = (
      <div
        data-testid="pseudo-side-by-side-loading"
        className="h-full flex items-center justify-center"
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
      </div>
    );
  } else if (pseudoExists === false) {
    rightContent = (
      <div
        data-testid="pseudo-side-by-side-empty"
        className="h-full flex items-center justify-center p-4"
      >
        <div className="max-w-md text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            No pseudo file found at{' '}
            <span className="font-mono">{pseudoDisplayPath}</span>
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Run <span className="font-mono">/pseudocode</span> to generate one.
          </p>
        </div>
      </div>
    );
  } else {
    rightContent = <PseudoViewer path={pseudoStem} project={projectPath} />;
  }

  return (
    <SplitPane
      direction="horizontal"
      defaultPrimarySize={60}
      minPrimarySize={20}
      minSecondarySize={20}
      storageId={`pseudo-side-by-side:${snippetId}`}
      primaryContent={children}
      secondaryContent={rightContent}
    />
  );
};

export default PseudoSideBySideView;
