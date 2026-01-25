# Interface: Item 4c - Collab Codex GUI Layout + Dashboard

## Interface Definition

### File Structure

- `codex/ui/src/components/layout/Layout.tsx`
- `codex/ui/src/components/layout/Sidebar.tsx`
- `codex/ui/src/components/layout/Header.tsx`
- `codex/ui/src/components/dashboard/Dashboard.tsx`
- `codex/ui/src/components/dashboard/StatCard.tsx`
- `codex/ui/src/components/dashboard/PendingDraftsList.tsx`
- `codex/ui/src/components/dashboard/OpenFlagsList.tsx`
- `codex/ui/src/components/dashboard/StaleTopicsList.tsx`
- `codex/ui/src/components/common/RefreshButton.tsx`
- `codex/ui/src/components/common/ConfidenceBadge.tsx`
- `codex/ui/src/components/common/StatusBadge.tsx`
- `codex/ui/src/hooks/useDashboard.ts`
- `codex/ui/src/pages/DashboardPage.tsx`

### Type Definitions

```typescript
// codex/ui/src/types/index.ts

interface DashboardStats {
  pendingDraftsCount: number;
  openFlagsCount: number;
  staleTopicsCount: number;
  missingTopicsCount: number;
  totalTopics: number;
  accessesThisWeek: number;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}
```

### Component Props

```typescript
// Layout.tsx
interface LayoutProps {
  children: React.ReactNode;
}

// Sidebar.tsx
interface SidebarProps {
  currentPath: string;
}

// StatCard.tsx
interface StatCardProps {
  label: string;
  value: number;
  onClick?: () => void;
  variant?: 'default' | 'warning' | 'error';
}

// PendingDraftsList.tsx
interface PendingDraftsListProps {
  drafts: { topicName: string; generatedAt: string }[];
  onSelect: (topicName: string) => void;
}

// OpenFlagsList.tsx
interface OpenFlagsListProps {
  flags: { topicName: string; comment: string; createdAt: string }[];
  onSelect: (topicName: string) => void;
  limit?: number;
}

// StaleTopicsList.tsx
interface StaleTopicsListProps {
  topics: { name: string; lastVerified: string; accessCount: number }[];
  onSelect: (topicName: string) => void;
}

// ConfidenceBadge.tsx
interface ConfidenceBadgeProps {
  tier: 'high' | 'medium' | 'low' | 'unknown';
}

// RefreshButton.tsx
interface RefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
}
```

### Hook Signatures

```typescript
// codex/ui/src/hooks/useDashboard.ts
function useDashboard(): {
  stats: DashboardStats | null;
  recentFlags: Flag[];
  staleTopic: Topic[];
  pendingDrafts: { topicName: string }[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}
```
