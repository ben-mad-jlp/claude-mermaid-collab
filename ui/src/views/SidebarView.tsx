import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useDataLoader } from '../hooks/useDataLoader';
import { useWebSocket } from '../hooks/useWebSocket';
import { getWebSocketClient } from '../lib/websocket';
import { useSubscriptionStore } from '../stores/subscriptionStore';
import { SessionInfo } from '../components/layout/SessionInfo';
import { VibeInstructions } from '../components/layout/VibeInstructions';
import { SubscriptionsPanel } from '../components/layout/SubscriptionsPanel';
import { ArtifactTree } from '../components/layout/sidebar-tree/ArtifactTree';

export function SidebarView() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const client = getWebSocketClient();
    const subscription = client.onMessage((message) => {
      switch (message.type) {
        case 'claude_session_registered': {
          const { claudeSessionId, project, session, claudePid } = message as any;
          useSubscriptionStore.getState().updateStatus(claudeSessionId, 'active', project, session, claudePid);
          break;
        }
        case 'claude_session_status': {
          const { claudeSessionId, project, session, status } = message as any;
          useSubscriptionStore.getState().updateStatus(claudeSessionId, status, project, session);
          break;
        }
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  const project = searchParams.get('project') ?? undefined;
  const session = searchParams.get('session') ?? undefined;

  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const currentSession = useSessionStore((s) => s.currentSession);
  const { loadSessionItems, loadSessions } = useDataLoader();
  const { isConnected: wsConnected, isConnecting: wsConnecting } = useWebSocket();

  useEffect(() => {
    if (!project || !session) return;
    setCurrentSession({ project, name: session });
    loadSessions();
    loadSessionItems(project, session);
  }, [project, session, setCurrentSession, loadSessions, loadSessionItems]);

  if (!project || !session) {
    return (
      <div className="p-4 text-sm text-gray-500">No session selected</div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <SessionInfo project={currentSession?.project ?? project ?? ''} session={currentSession?.name ?? session ?? ''} connected={wsConnected} isConnecting={wsConnecting} />
      <VibeInstructions vsCodeMode={true} />
      <SubscriptionsPanel currentProject={project ?? ''} onNavigate={loadSessionItems} />
      <ArtifactTree vsCodeMode={true} className="flex-1 min-h-0 w-full" />
    </div>
  );
}

export default SidebarView;
