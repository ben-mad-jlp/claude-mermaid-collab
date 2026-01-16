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

export interface ItemMetadata {
  folder: string | null;
  locked: boolean;
}

export interface Metadata {
  folders: string[];
  items: Record<string, ItemMetadata>;
}
