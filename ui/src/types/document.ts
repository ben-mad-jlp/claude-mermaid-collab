/**
 * Document Types - Core types for document operations
 */

export interface Document {
  id: string;
  name: string;
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
}
