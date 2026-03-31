export interface Diagram {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface DiagramMeta {
  name: string;
  path: string;
  lastModified: number;
}

export interface DiagramListItem {
  id: string;
  name: string;
  lastModified: number;
  deprecated?: boolean;
}

export interface Document {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface DocumentMeta {
  name: string;
  path: string;
  lastModified: number;
}

export interface DocumentListItem {
  id: string;
  name: string;
  lastModified: number;
  deprecated?: boolean;
}

export interface Spreadsheet {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface SpreadsheetMeta {
  name: string;
  path: string;
  lastModified: number;
}

export interface SpreadsheetListItem {
  id: string;
  name: string;
  lastModified: number;
  deprecated?: boolean;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface SnippetMeta {
  name: string;
  path: string;
  lastModified: number;
}

export interface SnippetListItem {
  id: string;
  name: string;
  lastModified: number;
  deprecated?: boolean;
}

export interface ItemMetadata {
  folder: string | null;
  locked: boolean;
  deprecated?: boolean;
  pinned?: boolean;
}

export interface Metadata {
  folders: string[];
  items: Record<string, ItemMetadata>;
}
