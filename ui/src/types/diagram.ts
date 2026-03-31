/**
 * Diagram Types - Core types for diagram operations
 */

export interface Diagram {
  id: string;
  name: string;
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
  deprecated?: boolean;
  pinned?: boolean;
}

export interface DiagramValidation {
  valid: boolean;
  error?: string;
  line?: number;
}
