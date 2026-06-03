/**
 * StudioShell — the Studio-mode left rail (Control-UI vision §3).
 *
 * A decluttered, strictly single-session spine. Thin compose: it arranges
 * existing primitives and deletes everything fleet-scoped. The center stage
 * (SplitEditorHost + EditorToolbar) and the right column (Terminal + Browser)
 * are reused untouched from App's layout — Studio only restyles the rail.
 *
 * Composes: session identity chip + ContextChip + InlineEscalationDock +
 * SessionTodos (flat checklist) + ArtifactTree (studio-scoped) + Servers.
 *
 * Deleted vs the full Sidebar: ProjectScopeSection (PROJECT select, ⇄ Sync,
 * work-graph plan tree, daemon Start/Stop, RoleSwitcher, SYSTEM strip),
 * SupervisorPanel, SubscriptionsPanel, and the Other-sessions expander.
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { diveLayoutId } from '@/components/stream/DiveTransition';
import { useTabsStore, useSessionTabs } from '@/stores/tabsStore';
import { ServersTreeSection } from '@/components/layout/sidebar-tree/ServersTreeSection';
import { ArtifactTree } from '@/components/layout/sidebar-tree/ArtifactTree';
import TodosTreeSection from '@/components/layout/sidebar-tree/TodosTreeSection';
import { WorktreeBadge } from '@/components/layout/WorktreeBadge';
import { ContextChip } from '@/components/layout/studio/ContextChip';
import { InlineEscalationDock } from '@/components/layout/studio/InlineEscalationDock';
import { StudioSessionPicker } from '@/components/layout/studio/StudioSessionPicker';
import { StudioTicker } from '@/components/stream/StudioTicker';
import { useDataLoader } from '@/hooks/useDataLoader';

export interface StudioShellProps {
  className?: string;
}

export const StudioShell: React.FC<StudioShellProps> = ({ className = '' }) => {
  const { documents, currentSession } = useSessionStore(
    useShallow((state) => ({
      documents: state.documents,
      currentSession: state.currentSession,
    })),
  );

  const openPreview = useTabsStore((s) => s.openPreview);
  const { selectDocumentWithContent } = useDataLoader();
  const { activeTabId } = useSessionTabs();
  const setMode = useUIStore((s) => s.setMode);

  const isDisabled = !currentSession;
  const vibeInstructionsDoc = documents.find((d) => d.name.endsWith('vibeinstructions')) || null;

  return (
    <aside
      key={currentSession?.name ?? 'no-session'}
      data-dive-id={diveLayoutId(currentSession?.name)}
      data-testid="studio-shell"
      className={`
        flex flex-col
        w-80 relative
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        animate-dive-in
        ${className}
      `.trim()}
    >
      {/* In-Studio entry point: pick a watched/recent session. Auto-expands when
          nothing is selected; collapses to a thin header once one is. */}
      <StudioSessionPicker />

      {/* Session identity chip + context gauge — pinned at the top. */}
      {currentSession && !isDisabled && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 space-y-1.5">
          <div className="flex items-center gap-2">
            <WorktreeBadge sessionId={currentSession.name} />
            <span className="text-xs font-semibold text-gray-900 dark:text-white truncate" title={currentSession.name}>
              {currentSession.name}
            </span>
            {/* Step back to the fleet — the reverse of a dive. */}
            <button
              type="button"
              onClick={() => setMode('bridge')}
              data-testid="step-back-to-bridge"
              title="Step back to Bridge (⌘2)"
              className="ml-auto px-1.5 py-0.5 text-3xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              ⤢ Bridge
            </button>
          </div>
          <ContextChip />
        </div>
      )}

      {/* Collapsed live ticker — cheap proof the session is moving. */}
      {currentSession && !isDisabled && <StudioTicker />}

      {/* This session's decision card docks here when it escalates. */}
      <InlineEscalationDock />

      {/* Vibe Instructions — kept as a quick pin. */}
      {vibeInstructionsDoc && !isDisabled && currentSession && (
        <div className="px-2 py-1 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              openPreview({
                id: vibeInstructionsDoc.id,
                kind: 'artifact',
                artifactType: 'document',
                artifactId: vibeInstructionsDoc.id,
                name: vibeInstructionsDoc.name,
              });
              selectDocumentWithContent(
                currentSession.serverId,
                currentSession.project,
                currentSession.name,
                vibeInstructionsDoc.id,
              );
            }}
            className={`
              w-full text-left px-3 py-2 rounded-lg
              flex items-center gap-2
              text-xs font-medium
              transition-colors
              ${activeTabId === vibeInstructionsDoc.id
                ? 'bg-accent-100 dark:bg-accent-900 sepia:bg-[#DFCA88] text-accent-700 dark:text-accent-300 sepia:text-[#586E75]'
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

      {/* Scrollable spine: session todos → this session's artifacts → servers. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <TodosTreeSection />
        <ArtifactTree studio />
        <ServersTreeSection />
      </div>
    </aside>
  );
};

export default StudioShell;
