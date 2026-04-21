import { useEffect } from 'react';
import { useDataLoader } from './useDataLoader';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { getSessionItemsCache, isCacheStale } from '@/lib/sessionItemsCache';

export function usePrefetchWatchedSessions(): void {
  const { loadSessionItems } = useDataLoader();
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const entries = Object.values(subscriptions);
    entries.forEach(({ project, session }, idx) => {
      const cached = getSessionItemsCache(project, session);
      if (!cached || isCacheStale(cached)) {
        setTimeout(() => {
          // Re-check subscription membership — session may have been unsubscribed during the stagger window
          const currentSubs = useSubscriptionStore.getState().subscriptions;
          const key = `${project}:${session}`;
          if (!currentSubs[key]) return;
          loadSessionItems(project, session);
        }, idx * 200);
      }
    });
  }, [Object.keys(subscriptions).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}
