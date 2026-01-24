/**
 * useFlags Hook
 *
 * Provides access to flags with filtering and actions.
 * Mock implementation for now - returns sample data.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Flag, FlagFilters, FlagStatus } from '../types';

export interface UseFlagsReturn {
  /** List of flags matching filters */
  flags: Flag[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Resolve a flag */
  resolve: (flagId: number, resolvedBy: string) => Promise<void>;
  /** Dismiss a flag */
  dismiss: (flagId: number, dismissedBy: string, reason?: string) => Promise<void>;
  /** Reopen a flag */
  reopen: (flagId: number, reopenedBy: string) => Promise<void>;
  /** Refresh the flags list */
  refresh: () => Promise<void>;
}

/**
 * Sample mock data for flags
 */
const MOCK_FLAGS: Flag[] = [
  {
    id: 1,
    topicName: 'react-hooks',
    comment: 'The useEffect cleanup section is incomplete and missing edge cases.',
    status: 'open',
    createdAt: '2025-01-22T10:30:00Z',
  },
  {
    id: 2,
    topicName: 'typescript-generics',
    comment: 'Missing examples for conditional types and mapped types.',
    status: 'open',
    createdAt: '2025-01-21T14:20:00Z',
  },
  {
    id: 3,
    topicName: 'docker-compose',
    comment: 'Volume mounting section has outdated syntax for version 3.8+',
    status: 'addressed',
    createdAt: '2025-01-18T09:00:00Z',
    addressedAt: '2025-01-20T11:00:00Z',
  },
  {
    id: 4,
    topicName: 'graphql-mutations',
    comment: 'Error handling patterns need updating for Apollo Client v4.',
    status: 'resolved',
    createdAt: '2025-01-15T16:45:00Z',
    resolvedAt: '2025-01-19T10:30:00Z',
  },
  {
    id: 5,
    topicName: 'kubernetes-pods',
    comment: 'Pod security context section is missing important security settings.',
    status: 'dismissed',
    createdAt: '2025-01-10T12:00:00Z',
    dismissedReason: 'Covered in separate security-contexts topic.',
  },
  {
    id: 6,
    topicName: 'redis-caching',
    comment: 'Cache invalidation strategies section is too brief.',
    status: 'open',
    createdAt: '2025-01-20T08:15:00Z',
  },
];

/**
 * Apply filters to flags
 */
function filterFlags(flags: Flag[], filters?: FlagFilters): Flag[] {
  if (!filters) return flags;

  return flags.filter((flag) => {
    // Filter by status
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes(flag.status)) {
        return false;
      }
    }

    // Filter by topic name
    if (filters.topicName) {
      if (flag.topicName !== filters.topicName) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Hook for fetching and managing flags
 *
 * @param filters - Optional filters to apply to the flags list
 * @returns Flags list with loading/error states and action functions
 *
 * @example
 * ```tsx
 * function FlagsList() {
 *   const { flags, isLoading, error, resolve, dismiss, reopen, refresh } = useFlags(
 *     { status: ['open', 'addressed'] }
 *   );
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {flags.map((flag) => (
 *         <li key={flag.id}>{flag.comment}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useFlags(filters?: FlagFilters): UseFlagsReturn {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchFlags = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Apply filters to mock data
      const filtered = filterFlags(MOCK_FLAGS, filters);
      setFlags(filtered);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch flags'));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  // Fetch flags on mount and when dependencies change
  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const refresh = useCallback(async () => {
    await fetchFlags();
  }, [fetchFlags]);

  const resolve = useCallback(
    async (flagId: number, _resolvedBy: string) => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 200));

      setFlags((prev) =>
        prev.map((flag) =>
          flag.id === flagId
            ? {
                ...flag,
                status: 'resolved' as FlagStatus,
                resolvedAt: new Date().toISOString(),
              }
            : flag
        )
      );
    },
    []
  );

  const dismiss = useCallback(
    async (flagId: number, _dismissedBy: string, reason?: string) => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 200));

      setFlags((prev) =>
        prev.map((flag) =>
          flag.id === flagId
            ? {
                ...flag,
                status: 'dismissed' as FlagStatus,
                dismissedReason: reason,
              }
            : flag
        )
      );
    },
    []
  );

  const reopen = useCallback(async (flagId: number, _reopenedBy: string) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 200));

    setFlags((prev) =>
      prev.map((flag) =>
        flag.id === flagId
          ? {
              ...flag,
              status: 'open' as FlagStatus,
              resolvedAt: undefined,
              dismissedReason: undefined,
            }
          : flag
      )
    );
  }, []);

  return {
    flags,
    isLoading,
    error,
    resolve,
    dismiss,
    reopen,
    refresh,
  };
}

export default useFlags;
