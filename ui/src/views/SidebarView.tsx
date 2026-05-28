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
import { SupervisorPanel } from '../components/layout/SupervisorPanel';
import { ServersTreeSection } from '../components/layout/sidebar-tree/ServersTreeSection';
import { ArtifactTree } from '../components/layout/sidebar-tree/ArtifactTree';

export function SidebarView() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const client = getWebSocketClient();
    const subscription = client.onMessage((message) => {
      switch (message.type) {
        case 'claude_session_registered': {
          const { claudeSessionId, project, session, claudePid } = message as any;
          const sid = (message as any).serverId ?? searchParams.get('srv');
          if (!sid) return;
          useSubscriptionStore.getState().updateStatus(sid, claudeSessionId, 'active', project, session, claudePid);
          break;
        }
        case 'claude_session_status': {
          const { claudeSessionId, project, session, status } = message as any;
          const sid = (message as any).serverId ?? searchParams.get('srv');
          if (!sid) return;
          useSubscriptionStore.getState().updateStatus(sid, claudeSessionId, status, project, session);
          break;
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [searchParams]);
  const project = searchParams.get('project') ?? undefined;
  const session = searchParams.get('session') ?? undefined;

  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const currentSession = useSessionStore((s) => s.currentSession);
  const { loadSessionItems, loadSessions } = useDataLoader();
  const { isConnected: wsConnected, isConnecting: wsConnecting } = useWebSocket();

  useEffect(() => {
    if (!project || !session) return;
    const resolvedServerId = searchParams.get('srv');
    if (!resolvedServerId) {
      console.warn('SidebarView: no ?srv= param; cannot resolve serverId');
      return;
    }
    setCurrentSession({ project, name: session, serverId: resolvedServerId });
    loadSessions();
    loadSessionItems(resolvedServerId, project, session);
  }, [project, session, setCurrentSession, loadSessions, loadSessionItems, searchParams]);

  if (!project || !session) {
    return (
      <div className="p-4 text-sm text-gray-500">No session selected</div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <SessionInfo project={currentSession?.project ?? project ?? ''} session={currentSession?.name ?? session ?? ''} connected={wsConnected} isConnecting={wsConnecting} />
      <VibeInstructions vsCodeMode={true} />
      <ServersTreeSection />
      <SupervisorPanel currentProject={project ?? ''} currentSession={session ?? ''} />
      <SubscriptionsPanel currentProject={project ?? ''} onNavigate={loadSessionItems} />
      <ArtifactTree vsCodeMode={true} className="flex-1 min-h-0 w-full" />
    </div>
  );
}

export default SidebarView;
