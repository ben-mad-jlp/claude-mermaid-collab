import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useTabsStore, useSessionTabs } from '@/stores/tabsStore';
import { SubscriptionsPanel } from '@/components/layout/SubscriptionsPanel';
import { ArtifactTree } from '@/components/layout/sidebar-tree/ArtifactTree';
import { WorktreeBadge } from '@/components/layout/WorktreeBadge';
import { useDataLoader } from '@/hooks/useDataLoader';

export interface SidebarProps {
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
}) => {
  const {
    documents,
    currentSession,
  } = useSessionStore(
    useShallow((state) => ({
      documents: state.documents,
      currentSession: state.currentSession,
    }))
  );

  const openPreview = useTabsStore((s) => s.openPreview);
  const { selectDocumentWithContent } = useDataLoader();
  const { activeTabId } = useSessionTabs();

  const isDisabled = !currentSession;
  const vibeInstructionsDoc = documents.find((d) => d.name.endsWith('vibeinstructions')) || null;

  return (
    <aside
      data-testid="sidebar"
      className={`
        flex flex-col
        w-72 relative
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        ${className}
      `.trim()}
    >
      {/* Vibe Instructions — pinned at top of sidebar */}
      {vibeInstructionsDoc && !isDisabled && currentSession && (
        <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700">
          <div className="px-1 pb-1 flex items-center gap-1">
            <WorktreeBadge sessionId={currentSession.name} />
          </div>
          <button
            onClick={() => {
              openPreview({
                id: vibeInstructionsDoc.id,
                kind: 'artifact',
                artifactType: 'document',
                artifactId: vibeInstructionsDoc.id,
                name: vibeInstructionsDoc.name,
              });
              selectDocumentWithContent(currentSession.project, currentSession.name, vibeInstructionsDoc.id);
            }}
            className={`
              w-full text-left px-3 py-2 rounded-lg
              flex items-center gap-2
              text-xs font-medium
              transition-colors
              ${activeTabId === vibeInstructionsDoc.id
                ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }
            `}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Vibe Instructions</span>
          </button>
        </div>
      )}
      <SubscriptionsPanel currentProject={currentSession?.project} />
      <ArtifactTree />
    </aside>
  );
};

export default Sidebar;
