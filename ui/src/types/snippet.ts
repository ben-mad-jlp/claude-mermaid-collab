/**
 * Snippet Types - Core types for snippet operations
 */

export interface SnippetAnnotation {
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed, inclusive
  text: string;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
}
