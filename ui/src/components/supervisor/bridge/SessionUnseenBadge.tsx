import React from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

export const SessionUnseenBadge: React.FC<{ subscriptionKey: string }> = ({ subscriptionKey }) => {
  const entry = useSubscriptionStore((s) => s.subscriptions[subscriptionKey]);
  const count = entry?.unseenCount ?? 0;

  return (
    <span
      data-testid="unseen-count"
      className="shrink-0 rounded-full px-1.5 py-0.5 text-3xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800"
    >
      {count}
    </span>
  );
};
