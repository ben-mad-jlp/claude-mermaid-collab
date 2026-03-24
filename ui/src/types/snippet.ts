/**
 * Snippet Types - Core types for snippet operations
 */

export interface Snippet {
  id: string;
  name: string;
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
}
