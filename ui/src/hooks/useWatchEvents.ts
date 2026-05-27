import { useEffect } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

/**
 * Feeds claude_session_* events forwarded by the main-process WatchAggregator
 * (from servers in the watch set) into the subscriptionStore. Passive: the
 * store's updateStatus ignores unsubscribed keys, so only subscribed sessions
 * update. No-op in a plain browser tab (no window.mc).
 */
export function useWatchEvents() {
  useEffect(() => {
    const mc = typeof window !== 'undefined' ? window.mc : undefined;
    if (!mc?.onWatchEvent) return;
    const unsub = mc.onWatchEvent((e) => {
      const { type, project, session, status, contextPercent, claudeSessionId, claudePid } = e;
      switch (type) {
        case 'claude_session_registered':
          useSubscriptionStore.getState().updateStatus(claudeSessionId!, 'active', project, session, claudePid);
          break;
        case 'claude_session_status':
          useSubscriptionStore.getState().updateStatus(claudeSessionId!, status!, project, session);
          break;
        case 'claude_context_update':
          useSubscriptionStore.getState().updateContextPercent(project, session, contextPercent!);
          break;
      }
    });
    return unsub;
  }, []);
}
