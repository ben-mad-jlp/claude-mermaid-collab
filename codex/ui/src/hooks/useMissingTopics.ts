/**
 * useMissingTopics Hook
 *
 * Provides access to missing topic requests with actions.
 * Mock implementation for now - returns sample data.
 */

import { useState, useEffect, useCallback } from 'react';
import type { MissingTopic } from '../types';

export interface UseMissingTopicsReturn {
  /** List of missing topics */
  topics: MissingTopic[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Dismiss a missing topic request */
  dismiss: (topicName: string, dismissedBy: string) => Promise<void>;
  /** Refresh the missing topics list */
  refresh: () => Promise<void>;
}

/**
 * Sample mock data for missing topics
 */
const MOCK_MISSING_TOPICS: MissingTopic[] = [
  {
    topicName: 'nextjs-app-router',
    requestCount: 12,
    firstRequestedAt: '2025-01-10T08:00:00Z',
    lastRequestedAt: '2025-01-22T14:30:00Z',
  },
  {
    topicName: 'prisma-migrations',
    requestCount: 8,
    firstRequestedAt: '2025-01-12T10:15:00Z',
    lastRequestedAt: '2025-01-21T09:45:00Z',
  },
  {
    topicName: 'tailwind-custom-plugins',
    requestCount: 5,
    firstRequestedAt: '2025-01-15T16:00:00Z',
    lastRequestedAt: '2025-01-20T11:20:00Z',
  },
  {
    topicName: 'vitest-mocking',
    requestCount: 4,
    firstRequestedAt: '2025-01-18T14:30:00Z',
    lastRequestedAt: '2025-01-22T08:00:00Z',
  },
  {
    topicName: 'zod-validation',
    requestCount: 3,
    firstRequestedAt: '2025-01-19T09:00:00Z',
    lastRequestedAt: '2025-01-21T16:45:00Z',
  },
];

/**
 * Hook for fetching and managing missing topics
 *
 * @returns Missing topics list with loading/error states and action functions
 *
 * @example
 * ```tsx
 * function MissingTopicsList() {
 *   const { topics, isLoading, error, dismiss, refresh } = useMissingTopics();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {topics.map((topic) => (
 *         <li key={topic.topicName}>{topic.topicName} ({topic.requestCount} requests)</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useMissingTopics(): UseMissingTopicsReturn {
  const [topics, setTopics] = useState<MissingTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTopics = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Sort by request count descending
      const sorted = [...MOCK_MISSING_TOPICS].sort(
        (a, b) => b.requestCount - a.requestCount
      );
      setTopics(sorted);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch missing topics')
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch topics on mount
  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const refresh = useCallback(async () => {
    await fetchTopics();
  }, [fetchTopics]);

  const dismiss = useCallback(async (topicName: string, _dismissedBy: string) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 200));

    setTopics((prev) => prev.filter((topic) => topic.topicName !== topicName));
  }, []);

  return {
    topics,
    isLoading,
    error,
    dismiss,
    refresh,
  };
}

export default useMissingTopics;
