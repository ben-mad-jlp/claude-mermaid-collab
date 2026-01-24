/**
 * useDrafts Hook
 *
 * Provides access to draft data for topics.
 * Mock implementation - returns sample data for development.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DraftInfo, DocumentDiff, DocumentType } from '../types';

/**
 * Return type for useDrafts hook
 */
export interface UseDraftsReturn {
  /** List of drafts with basic info */
  drafts: { topicName: string; generatedAt: string }[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refresh the drafts list */
  refresh: () => Promise<void>;
}

/**
 * Return type for useDraft hook
 */
export interface UseDraftReturn {
  /** Full draft information */
  draft: DraftInfo | null;
  /** Document diffs between current and draft */
  diff: DocumentDiff[] | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Approve the draft */
  approve: (approvedBy: string) => Promise<void>;
  /** Reject the draft */
  reject: (rejectedBy: string, reason?: string) => Promise<void>;
}

/**
 * Mock draft data
 */
const MOCK_DRAFTS: Record<string, DraftInfo> = {
  'docker-compose': {
    topicName: 'docker-compose',
    generatedAt: '2025-01-22T14:30:00Z',
    triggerType: 'source_change',
    documents: {
      conceptual: `# Docker Compose

Docker Compose is a tool for defining and running multi-container Docker applications.

## Key Features

- Define services in a single YAML file
- Start all services with a single command
- Manage networking between containers
- Handle volumes and data persistence

## New in Compose V2

- Integrated into Docker CLI as \`docker compose\`
- Improved build performance
- Better secret management
- Support for profiles
`,
      technical: `# Docker Compose Technical Reference

## Basic Structure

\`\`\`yaml
version: '3.9'
services:
  web:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
\`\`\`

## Common Commands

\`\`\`bash
docker compose up -d
docker compose down
docker compose logs -f
docker compose ps
docker compose exec web sh
\`\`\`

## Advanced Features

- **Profiles**: Group services for selective startup
- **Secrets**: Manage sensitive data securely
- **Extensions**: Reuse configuration fragments
`,
      files: `# Related Files

- \`docker-compose.yml\` - Main compose file
- \`docker-compose.dev.yml\` - Development overrides
- \`docker-compose.prod.yml\` - Production overrides
- \`docker-compose.test.yml\` - Test environment
- \`.env\` - Environment variables
`,
      related: `# Related Topics

- [Docker networking](/topics/docker-networking)
- [Docker volumes](/topics/docker-volumes)
- [Docker secrets](/topics/docker-secrets)
- [Kubernetes](/topics/kubernetes-basics)
`,
    },
  },
  'react-context': {
    topicName: 'react-context',
    generatedAt: '2025-01-21T10:00:00Z',
    triggerType: 'flag_response',
    documents: {
      conceptual: `# React Context

React Context provides a way to pass data through the component tree without having to pass props manually at every level.

## When to Use Context

- Theme data (dark/light mode)
- User authentication state
- Locale preferences
- Application configuration

## Best Practices

- Keep context values stable
- Split contexts by domain
- Use context sparingly for global state
`,
      technical: `# React Context Technical Reference

## Creating Context

\`\`\`typescript
interface ThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
\`\`\`

## Provider Pattern

\`\`\`typescript
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
\`\`\`

## Custom Hook Pattern

\`\`\`typescript
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
\`\`\`
`,
      files: `# Related Files

- \`src/contexts/ThemeContext.tsx\`
- \`src/contexts/AuthContext.tsx\`
- \`src/hooks/useTheme.ts\`
`,
      related: `# Related Topics

- [React Hooks](/topics/react-hooks)
- [State Management](/topics/react-state-management)
- [Zustand](/topics/zustand)
`,
    },
  },
};

/**
 * Mock current document data (for diff calculation)
 */
const MOCK_CURRENT_DOCS: Record<
  string,
  { conceptual: string; technical: string; files: string; related: string }
> = {
  'docker-compose': {
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
};

/**
 * Calculate simple line-based diff statistics
 */
function calculateDiffStats(
  current: string,
  draft: string
): { additions: number; deletions: number } {
  const currentLines = current.split('\n');
  const draftLines = draft.split('\n');

  // Simple heuristic: count lines only in draft as additions,
  // lines only in current as deletions
  const currentSet = new Set(currentLines.map((l) => l.trim()));
  const draftSet = new Set(draftLines.map((l) => l.trim()));

  let additions = 0;
  let deletions = 0;

  for (const line of draftLines) {
    if (line.trim() && !currentSet.has(line.trim())) {
      additions++;
    }
  }

  for (const line of currentLines) {
    if (line.trim() && !draftSet.has(line.trim())) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * Hook for fetching list of all drafts
 *
 * @returns List of drafts with loading/error states
 *
 * @example
 * ```tsx
 * function DraftsList() {
 *   const { drafts, isLoading, error, refresh } = useDrafts();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {drafts.map(d => <li key={d.topicName}>{d.topicName}</li>)}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useDrafts(): UseDraftsReturn {
  const [drafts, setDrafts] = useState<
    { topicName: string; generatedAt: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDrafts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      const draftsList = Object.values(MOCK_DRAFTS).map((d) => ({
        topicName: d.topicName,
        generatedAt: d.generatedAt,
      }));

      setDrafts(draftsList);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch drafts')
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const refresh = useCallback(async () => {
    await fetchDrafts();
  }, [fetchDrafts]);

  return {
    drafts,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Hook for fetching a single draft with diff information
 *
 * @param topicName - The topic name to fetch draft for
 * @returns Draft data with diff and action functions
 *
 * @example
 * ```tsx
 * function DraftReview({ topicName }: { topicName: string }) {
 *   const { draft, diff, isLoading, approve, reject } = useDraft(topicName);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!draft) return <div>No draft found</div>;
 *
 *   return (
 *     <div>
 *       <h2>{draft.topicName}</h2>
 *       <button onClick={() => approve('john')}>Approve</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useDraft(topicName: string): UseDraftReturn {
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [diff, setDiff] = useState<DocumentDiff[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDraft = useCallback(async () => {
    if (!topicName) {
      setDraft(null);
      setDiff(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      const draftData = MOCK_DRAFTS[topicName];
      if (!draftData) {
        setDraft(null);
        setDiff(null);
        setIsLoading(false);
        return;
      }

      setDraft(draftData);

      // Calculate diffs
      const currentDocs = MOCK_CURRENT_DOCS[topicName] || {
        conceptual: '',
        technical: '',
        files: '',
        related: '',
      };

      const documentTypes: DocumentType[] = [
        'conceptual',
        'technical',
        'files',
        'related',
      ];
      const diffs: DocumentDiff[] = documentTypes.map((docType) => {
        const current = currentDocs[docType] || '';
        const draftContent = draftData.documents[docType] || '';
        const stats = calculateDiffStats(current, draftContent);

        return {
          documentType: docType,
          current,
          draft: draftContent,
          additions: stats.additions,
          deletions: stats.deletions,
        };
      });

      setDiff(diffs);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch draft'));
      setDraft(null);
      setDiff(null);
    } finally {
      setIsLoading(false);
    }
  }, [topicName]);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  const approve = useCallback(
    async (approvedBy: string) => {
      if (!draft) return;

      try {
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log(`Draft for ${draft.topicName} approved by ${approvedBy}`);

        // Clear the draft after approval (simulating successful merge)
        setDraft(null);
        setDiff(null);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to approve draft')
        );
      }
    },
    [draft]
  );

  const reject = useCallback(
    async (rejectedBy: string, reason?: string) => {
      if (!draft) return;

      try {
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log(
          `Draft for ${draft.topicName} rejected by ${rejectedBy}`,
          reason ? `Reason: ${reason}` : ''
        );

        // Clear the draft after rejection
        setDraft(null);
        setDiff(null);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to reject draft')
        );
      }
    },
    [draft]
  );

  return {
    draft,
    diff,
    isLoading,
    error,
    approve,
    reject,
  };
}

export default useDrafts;
