/**
 * Collab Codex UI Type Definitions
 * Central export for all types used in the Codex dashboard
 */

// Import types for use in interfaces
import type {
  ConfidenceTier as ConfidenceTierType,
  TopicFlag as TopicFlagType,
} from '../../../src/types';

// Re-export backend types
export type {
  Topic,
  TopicFlag,
  DashboardStats,
  ConfidenceTier,
  TopicContent,
  QueryResult,
} from '../../../src/types';

// UI-specific types

/**
 * Navigation item for sidebar
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

/**
 * Generic list item for topic lists, flag lists, etc.
 */
export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: {
    text: string;
    variant: 'default' | 'warning' | 'error';
  };
  href: string;
}

/**
 * Document type for topic content tabs
 */
export type DocumentType = 'conceptual' | 'technical' | 'files' | 'related';

/**
 * Summary view of a topic for list displays
 */
export interface TopicSummary {
  name: string;
  confidence: ConfidenceTierType;
  lastVerified: string | null;
  accessCount: number;
  openFlagCount: number;
  hasDraft: boolean;
}

/**
 * Full topic data including all documents
 */
export interface TopicFull extends TopicSummary {
  documents: {
    conceptual: string;
    technical: string;
    files: string;
    related: string;
  };
  lastModified: string | null;
  flags: TopicFlagType[];
}

/**
 * Filters for topic list
 */
export interface TopicFilters {
  confidence?: ConfidenceTierType[];
  hasFlags?: boolean;
  hasDraft?: boolean;
  staleDays?: number;
}

/**
 * Sort options for topic list
 */
export type TopicSortBy = 'name' | 'confidence' | 'lastVerified' | 'accessCount';

/**
 * Sort order direction
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Draft trigger type - what caused the draft to be generated
 */
export type DraftTriggerType =
  | 'flag_response'
  | 'missing_topic'
  | 'scheduled_refresh'
  | 'source_change'
  | 'manual';

/**
 * Draft information for a topic
 */
export interface DraftInfo {
  topicName: string;
  documents: {
    conceptual: string;
    technical: string;
    files: string;
    related: string;
  };
  generatedAt: string;
  triggerType: DraftTriggerType;
}

/**
 * Document diff showing changes between current and draft
 */
export interface DocumentDiff {
  documentType: DocumentType;
  current: string;
  draft: string;
  additions: number;
  deletions: number;
}

/**
 * View mode for draft review
 */
export type DraftViewMode = 'current' | 'draft' | 'diff';

/**
 * Flag status type
 */
export type FlagStatus = 'open' | 'addressed' | 'resolved' | 'dismissed';

/**
 * Flag interface for tracking issues on topics
 */
export interface Flag {
  id: number;
  topicName: string;
  comment: string;
  status: FlagStatus;
  createdAt: string;
  addressedAt?: string;
  resolvedAt?: string;
  dismissedReason?: string;
}

/**
 * Missing topic request tracking
 */
export interface MissingTopic {
  topicName: string;
  requestCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
}

/**
 * Filters for flag list
 */
export interface FlagFilters {
  status?: FlagStatus[];
  topicName?: string;
}
