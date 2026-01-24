/**
 * Collab Codex Type Definitions
 * Knowledge base system for collaborative documentation
 */

// Confidence tiers for topic content
export type ConfidenceTier = 'high' | 'medium' | 'low';

// A knowledge base topic
export interface Topic {
  name: string; // Topic identifier (slug)
  title: string; // Human-readable title
  confidence: ConfidenceTier;
  lastUpdated: string; // ISO date
  lastAccessed?: string; // ISO date
  accessCount: number;
  // Content files stored at codex/topics/{name}/
  // - summary.md, concepts.md, examples.md, gotchas.md
}

// A flag on a topic indicating it needs attention
export interface TopicFlag {
  id: string;
  topicName: string;
  type: 'outdated' | 'incomplete' | 'incorrect' | 'needs-review';
  description: string;
  createdAt: string; // ISO date
  resolvedAt?: string; // ISO date
}

// Dashboard statistics
export interface DashboardStats {
  totalTopics: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  pendingDrafts: number;
  openFlags: number;
  staleTopics: number; // Not accessed in 30+ days
}

// Topic content sections
export interface TopicContent {
  summary: string;
  concepts: string;
  examples: string;
  gotchas: string;
}

// Query result from MCP
export interface QueryResult {
  topic: Topic;
  content: TopicContent;
}
