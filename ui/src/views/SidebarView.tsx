import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useDataLoader } from '../hooks/useDataLoader';
import { useWebSocket } from '../hooks/useWebSocket';
import { SidebarHeader } from '../components/layout/SidebarHeader';
import { SessionInfo } from '../components/layout/SessionInfo';
import { VibeInstructions } from '../components/layout/VibeInstructions';
import { SubscriptionsPanel } from '../components/layout/SubscriptionsPanel';
import { ArtifactTree } from '../components/layout/sidebar-tree/ArtifactTree';

export function SidebarView() {
  const [searchParams] = useSearchParams();
  const project = searchParams.get('project') ?? undefined;
  const session = searchParams.get('session') ?? undefined;

  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const { loadSessionItems } = useDataLoader();
  const { isConnected: wsConnected } = useWebSocket();

  useEffect(() => {
    if (!project || !session) return;
    setCurrentSession({ project, name: session });
    loadSessionItems(project, session);
  }, [project, session, setCurrentSession, loadSessionItems]);

  const handleRefresh = () => {
    if (!project || !session) return;
    loadSessionItems(project!, session!);
  };

  if (!project || !session) {
    return (
      <div className="p-4 text-sm text-gray-500">No session selected</div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <SidebarHeader connected={wsConnected} />
      <SessionInfo project={project ?? ''} session={session ?? ''} onRefresh={handleRefresh} />
      <VibeInstructions vsCodeMode={true} />
      <div className="flex-1 overflow-y-auto">
        <SubscriptionsPanel currentProject={project ?? ''} />
        <ArtifactTree vsCodeMode={true} />
      </div>
    </div>
  );
}

export default SidebarView;
