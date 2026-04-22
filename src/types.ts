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

export interface SnippetTag {
  type: 'file' | 'symbol' | 'layer' | 'domain';
  value: string;
  resolvedPath?: string;
  lastResolvedAt?: string;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  language: string;
  tags: SnippetTag[];
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

export interface ProposedEdit {
  newCode: string;
  message?: string;
  proposedBy: string;
  proposedAt: number;
}

export interface CodeFile {
  id: string;
  filePath: string;
  name: string;
  content: string;
  language: string;
  contentHash: string;
  dirty: boolean;
  linkCreatedAt: number;
  lastPushedAt: number | null;
  lastSyncedAt: number | null;
  proposedEdit?: ProposedEdit;
  lastModified: number;
}

export interface Embed {
  id: string;
  name: string;
  url: string;
  subtype?: 'storybook';
  width?: string;
  height?: string;
  createdAt: string;
  storybook?: { storyId: string; port: number };
}

export interface EmbedMeta {
  name: string;
  path: string;
  createdAt: string;
}

export interface EmbedListItem {
  id: string;
  name: string;
  url: string;
  subtype?: 'storybook';
  createdAt: string;
}

export interface Image {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string; // ISO
  ext: string;        // file extension without dot
  path: string;       // absolute path to binary on disk
}

export interface ImageMeta {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  ext: string;
}

export interface ImageListItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface ItemMetadata {
  folder: string | null;
  locked: boolean;
  deprecated?: boolean;
  pinned?: boolean;
  blueprint?: boolean;
}

export interface Metadata {
  folders: string[];
  items: Record<string, ItemMetadata>;
}
