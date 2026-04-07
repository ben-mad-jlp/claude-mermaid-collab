import React, { useState, useMemo, useCallback } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';

export interface SubscriptionsPanelProps {
  currentProject?: string;
}

export const SubscriptionsPanel: React.FC<SubscriptionsPanelProps> = ({ currentProject }) => {
  const { subscriptions, unsubscribe, subscribe } = useSubscriptionStore();
  const { sessions, setCurrentSession } = useSessionStore();

  const [collapsed, setCollapsed] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const subscriptionEntries = useMemo(
    () => Object.entries(subscriptions),
    [subscriptions],
  );

  // Show all subscriptions across all projects
  const projectSubscriptions = subscriptionEntries;

  // Sessions available for subscribing (not already subscribed, from all projects)
  const availableSessions = useMemo(() => {
    const subscribedKeys = new Set(
      projectSubscriptions.map(([key]) => key),
    );
    return sessions.filter(
      (s) => !subscribedKeys.has(`${s.project}:${s.name}`),
    );
  }, [sessions, projectSubscriptions]);

  const handleNavigate = useCallback(
    (project: string, sessionName: string) => {
      const target = sessions.find(
        (s) => s.project === project && s.name === sessionName,
      );
      if (target) {
        setCurrentSession(target);
      }
    },
    [sessions, setCurrentSession],
  );

  const handleSubscribe = useCallback(
    (project: string, sessionName: string) => {
      subscribe(project, sessionName);
      setShowDropdown(false);
    },
    [subscribe],
  );

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>Watching</span>
          <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
            {projectSubscriptions.length}
          </span>
          <svg
            className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* Subscribe button */}
        <button
          onClick={() => setShowDropdown(true)}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Subscribe to a session"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* Subscribe modal */}
        {showDropdown && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDropdown(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl w-80 max-h-96 flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Watch a session</span>
                <button onClick={() => setShowDropdown(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto py-1">
                {availableSessions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                    No sessions available to watch
                  </div>
                ) : (
                  availableSessions.map((s) => (
                    <button
                      key={`${s.project}:${s.name}`}
                      onClick={() => handleSubscribe(s.project, s.name)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="text-gray-400 dark:text-gray-500">{s.project.split('/').pop()}</span>
                      <span className="text-gray-400 dark:text-gray-500"> / </span>
                      <span className="text-gray-900 dark:text-gray-100">{s.displayName || s.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subscription items */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1">
          {projectSubscriptions.map(([key, sub]) => (
            <div
              key={key}
              className="group flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              onClick={() => handleNavigate(sub.project, sub.session)}
            >
              {/* Status dot */}
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  sub.status === 'active'
                    ? 'status-pulse bg-amber-400'
                    : sub.status === 'waiting'
                      ? 'bg-green-400'
                      : 'bg-gray-400'
                }`}
              />
              {/* Project / Session */}
              <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 truncate">
                <span className="text-gray-400 dark:text-gray-500">{sub.project.split('/').pop()}</span>
                <span className="text-gray-400 dark:text-gray-500"> / </span>
                {sub.session}
              </span>
              {/* Unsubscribe button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  unsubscribe(key);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity"
                title="Unsubscribe"
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
