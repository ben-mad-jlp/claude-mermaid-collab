/**
 * useTopics Hook
 *
 * Provides access to the list of topics with filtering and sorting.
 * Mock implementation for now - returns sample data.
 */

import { useState, useEffect, useCallback } from 'react';
import type { TopicSummary, TopicFilters, TopicSortBy, SortOrder } from '../types';

export interface UseTopicsReturn {
  /** List of topics matching filters */
  topics: TopicSummary[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refresh the topic list */
  refresh: () => Promise<void>;
}

/**
 * Sample mock data for topics
 */
const MOCK_TOPICS: TopicSummary[] = [
  {
    name: 'react-hooks',
    confidence: 'high',
    lastVerified: '2025-01-20T10:30:00Z',
    accessCount: 42,
    openFlagCount: 0,
    hasDraft: false,
  },
  {
    name: 'typescript-generics',
    confidence: 'high',
    lastVerified: '2025-01-18T14:20:00Z',
    accessCount: 35,
    openFlagCount: 1,
    hasDraft: false,
  },
  {
    name: 'docker-compose',
    confidence: 'medium',
    lastVerified: '2025-01-10T09:00:00Z',
    accessCount: 28,
    openFlagCount: 0,
    hasDraft: true,
  },
  {
    name: 'graphql-mutations',
    confidence: 'medium',
    lastVerified: '2024-12-15T16:45:00Z',
    accessCount: 15,
    openFlagCount: 2,
    hasDraft: false,
  },
  {
    name: 'kubernetes-pods',
    confidence: 'low',
    lastVerified: null,
    accessCount: 8,
    openFlagCount: 0,
    hasDraft: true,
  },
  {
    name: 'redis-caching',
    confidence: 'low',
    lastVerified: '2024-11-20T12:00:00Z',
    accessCount: 5,
    openFlagCount: 3,
    hasDraft: false,
  },
];

/**
 * Check if a topic is stale (not verified within staleDays)
 */
function isStale(lastVerified: string | null, staleDays: number): boolean {
  if (!lastVerified) return true;
  const verifiedDate = new Date(lastVerified);
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - staleDays);
  return verifiedDate < staleDate;
}

/**
 * Apply filters to topics
 */
function filterTopics(topics: TopicSummary[], filters?: TopicFilters): TopicSummary[] {
  if (!filters) return topics;

  return topics.filter((topic) => {
    // Filter by confidence
    if (filters.confidence && filters.confidence.length > 0) {
      if (!filters.confidence.includes(topic.confidence)) {
        return false;
      }
    }

    // Filter by has flags
    if (filters.hasFlags !== undefined) {
      if (filters.hasFlags && topic.openFlagCount === 0) {
        return false;
      }
      if (!filters.hasFlags && topic.openFlagCount > 0) {
        return false;
      }
    }

    // Filter by has draft
    if (filters.hasDraft !== undefined) {
      if (filters.hasDraft !== topic.hasDraft) {
        return false;
      }
    }

    // Filter by stale
    if (filters.staleDays !== undefined) {
      if (!isStale(topic.lastVerified, filters.staleDays)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Sort topics by specified field and order
 */
function sortTopics(
  topics: TopicSummary[],
  sortBy: TopicSortBy = 'name',
  sortOrder: SortOrder = 'asc'
): TopicSummary[] {
  const sorted = [...topics].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'confidence': {
        const confidenceOrder = { high: 3, medium: 2, low: 1 };
        comparison = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        break;
      }
      case 'lastVerified': {
        const aDate = a.lastVerified ? new Date(a.lastVerified).getTime() : 0;
        const bDate = b.lastVerified ? new Date(b.lastVerified).getTime() : 0;
        comparison = aDate - bDate;
        break;
      }
      case 'accessCount':
        comparison = a.accessCount - b.accessCount;
        break;
      default:
        comparison = 0;
    }

    return sortOrder === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Hook for fetching and managing the topics list
 *
 * @param filters - Optional filters to apply to the topic list
 * @param sortBy - Field to sort by (default: 'name')
 * @param sortOrder - Sort direction (default: 'asc')
 * @returns Topics list with loading/error states and refresh function
 *
 * @example
 * ```tsx
 * function TopicList() {
 *   const { topics, isLoading, error, refresh } = useTopics(
 *     { confidence: ['high', 'medium'] },
 *     'accessCount',
 *     'desc'
 *   );
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {topics.map((topic) => (
 *         <li key={topic.name}>{topic.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useTopics(
  filters?: TopicFilters,
  sortBy: TopicSortBy = 'name',
  sortOrder: SortOrder = 'asc'
): UseTopicsReturn {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTopics = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Apply filters and sorting to mock data
      const filtered = filterTopics(MOCK_TOPICS, filters);
      const sorted = sortTopics(filtered, sortBy, sortOrder);

      setTopics(sorted);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch topics'));
    } finally {
      setIsLoading(false);
    }
  }, [filters, sortBy, sortOrder]);

  // Fetch topics on mount and when dependencies change
  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const refresh = useCallback(async () => {
    await fetchTopics();
  }, [fetchTopics]);

  return {
    topics,
    isLoading,
    error,
    refresh,
  };
}

export default useTopics;
