/**
 * useTopic Hook
 *
 * Provides access to a single topic's full data including documents.
 * Mock implementation for now - returns sample data.
 */

import { useState, useEffect, useCallback } from 'react';
import type { TopicFull } from '../types';

export interface UseTopicReturn {
  /** Full topic data */
  topic: TopicFull | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Update the lastVerifiedAt timestamp */
  verify: () => Promise<void>;
  /** Refresh the topic data */
  refresh: () => Promise<void>;
}

/**
 * Sample mock data for full topics
 */
const MOCK_TOPICS_FULL: Record<string, TopicFull> = {
  'react-hooks': {
    name: 'react-hooks',
    confidence: 'high',
    lastVerified: '2025-01-20T10:30:00Z',
    lastModified: '2025-01-15T08:00:00Z',
    accessCount: 42,
    openFlagCount: 0,
    hasDraft: false,
    documents: {
      conceptual: `# React Hooks

React Hooks are functions that let you "hook into" React state and lifecycle features from function components.

## Key Concepts

- **useState** - Adds state to functional components
- **useEffect** - Performs side effects in components
- **useContext** - Subscribes to React context
- **useReducer** - Alternative to useState for complex state logic
- **useCallback** - Returns a memoized callback function
- **useMemo** - Returns a memoized value

## Rules of Hooks

1. Only call Hooks at the top level
2. Only call Hooks from React functions
`,
      technical: `# React Hooks Technical Reference

## useState

\`\`\`typescript
const [state, setState] = useState<T>(initialValue);
\`\`\`

## useEffect

\`\`\`typescript
useEffect(() => {
  // Effect logic
  return () => {
    // Cleanup function
  };
}, [dependencies]);
\`\`\`

## useCallback

\`\`\`typescript
const memoizedCallback = useCallback(() => {
  doSomething(a, b);
}, [a, b]);
\`\`\`
`,
      files: `# Related Files

- \`src/hooks/useCustomHook.ts\` - Custom hook implementations
- \`src/components/HookExamples.tsx\` - Usage examples
- \`tests/hooks.test.ts\` - Hook unit tests
`,
      related: `# Related Topics

- [useState in depth](/topics/react-usestate)
- [useEffect patterns](/topics/react-useeffect)
- [Custom hooks](/topics/react-custom-hooks)
- [React context](/topics/react-context)
`,
    },
    flags: [],
  },
  'typescript-generics': {
    name: 'typescript-generics',
    confidence: 'high',
    lastVerified: '2025-01-18T14:20:00Z',
    lastModified: '2025-01-12T11:30:00Z',
    accessCount: 35,
    openFlagCount: 1,
    hasDraft: false,
    documents: {
      conceptual: `# TypeScript Generics

Generics allow you to create reusable components that work with a variety of types rather than a single one.

## Why Generics?

- Type safety without sacrificing flexibility
- Reusable code that works with multiple types
- Better IDE support and autocompletion

## Basic Syntax

\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}
\`\`\`
`,
      technical: `# TypeScript Generics Technical Reference

## Generic Functions

\`\`\`typescript
function firstElement<T>(arr: T[]): T | undefined {
  return arr[0];
}
\`\`\`

## Generic Interfaces

\`\`\`typescript
interface Container<T> {
  value: T;
  getValue(): T;
}
\`\`\`

## Generic Constraints

\`\`\`typescript
function getLength<T extends { length: number }>(arg: T): number {
  return arg.length;
}
\`\`\`
`,
      files: `# Related Files

- \`src/types/generics.ts\` - Generic type definitions
- \`src/utils/typeUtils.ts\` - Generic utility functions
`,
      related: `# Related Topics

- [Type inference](/topics/typescript-inference)
- [Conditional types](/topics/typescript-conditional)
- [Mapped types](/topics/typescript-mapped)
`,
    },
    flags: [
      {
        id: 'flag-1',
        topicName: 'typescript-generics',
        type: 'needs-review',
        description: 'Examples need to be updated for TypeScript 5.0',
        createdAt: '2025-01-15T09:00:00Z',
      },
    ],
  },
  'docker-compose': {
    name: 'docker-compose',
    confidence: 'medium',
    lastVerified: '2025-01-10T09:00:00Z',
    lastModified: '2025-01-08T15:00:00Z',
    accessCount: 28,
    openFlagCount: 0,
    hasDraft: true,
    documents: {
      conceptual: `# Docker Compose

Docker Compose is a tool for defining and running multi-container Docker applications.

## Key Features

- Define services in a single YAML file
- Start all services with a single command
- Manage networking between containers
- Handle volumes and data persistence
`,
      technical: `# Docker Compose Technical Reference

## Basic Structure

\`\`\`yaml
version: '3.8'
services:
  web:
    build: .
    ports:
      - "3000:3000"
  db:
    image: postgres:14
    environment:
      POSTGRES_PASSWORD: secret
\`\`\`

## Common Commands

\`\`\`bash
docker-compose up -d
docker-compose down
docker-compose logs -f
\`\`\`
`,
      files: `# Related Files

- \`docker-compose.yml\` - Main compose file
- \`docker-compose.dev.yml\` - Development overrides
- \`docker-compose.prod.yml\` - Production overrides
`,
      related: `# Related Topics

- [Docker networking](/topics/docker-networking)
- [Docker volumes](/topics/docker-volumes)
- [Kubernetes](/topics/kubernetes-basics)
`,
    },
    flags: [],
  },
};

/**
 * Hook for fetching and managing a single topic's data
 *
 * @param name - The topic name/slug to fetch
 * @returns Topic data with loading/error states and action functions
 *
 * @example
 * ```tsx
 * function TopicView({ name }: { name: string }) {
 *   const { topic, isLoading, error, verify, refresh } = useTopic(name);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!topic) return <div>Topic not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{topic.name}</h1>
 *       <button onClick={verify}>Mark as Verified</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTopic(name: string): UseTopicReturn {
  const [topic, setTopic] = useState<TopicFull | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTopic = useCallback(async () => {
    if (!name) {
      setTopic(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      const topicData = MOCK_TOPICS_FULL[name];

      if (!topicData) {
        throw new Error(`Topic "${name}" not found`);
      }

      setTopic(topicData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch topic'));
      setTopic(null);
    } finally {
      setIsLoading(false);
    }
  }, [name]);

  // Fetch topic on mount and when name changes
  useEffect(() => {
    fetchTopic();
  }, [fetchTopic]);

  const verify = useCallback(async () => {
    if (!topic) return;

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Update the lastVerified timestamp
      setTopic((prev) =>
        prev
          ? {
              ...prev,
              lastVerified: new Date().toISOString(),
            }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to verify topic'));
    }
  }, [topic]);

  const refresh = useCallback(async () => {
    await fetchTopic();
  }, [fetchTopic]);

  return {
    topic,
    isLoading,
    error,
    verify,
    refresh,
  };
}

export default useTopic;
