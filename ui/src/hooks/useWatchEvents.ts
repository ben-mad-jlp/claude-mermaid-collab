import { useEffect } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';

/**
 * Feeds claude_session_* events forwarded by the main-process WatchAggregator
 * (from servers in the watch set) into the subscriptionStore. Passive: the
 * store's updateStatus ignores unsubscribed keys, so only subscribed sessions
 * update. No-op in a plain browser tab (no window.mc).
 *
 * Each event carries `e.serverId` (tagged by the aggregator); forward it so
 * the composite key `${serverId}:${project}:${session}` resolves correctly.
 */
export function useWatchEvents() {
  useEffect(() => {
    const mc = typeof window !== 'undefined' ? window.mc : undefined;
    if (!mc?.onWatchEvent) return;
    const unsub = mc.onWatchEvent((e) => {
      const { serverId, type, project, session, status, contextPercent, claudeSessionId, claudePid } = e;
      if (!serverId) return;
      switch (type) {
        case 'claude_session_registered':
          useSubscriptionStore.getState().ensureSubscribed(`${serverId}:${project}:${session}`, { serverId, project, session, status: 'active' });
          useSessionStore.getState().upsertSession({ project, name: session, serverId });
          useSubscriptionStore.getState().updateStatus(serverId, claudeSessionId!, 'active', project, session, claudePid);
          break;
        case 'claude_session_status':
          useSubscriptionStore.getState().updateStatus(serverId, claudeSessionId!, status!, project, session);
          break;
        case 'claude_context_update':
          useSubscriptionStore.getState().updateContextPercent(serverId, project, session, contextPercent!);
          break;
      }
    });
    return unsub;
  }, []);
}
