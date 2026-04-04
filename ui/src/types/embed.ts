/**
 * Embed Types
 * Core types for embed operations
 */

export interface StorybookMetadata {
  storyId: string;
  port: number;
}

export interface Embed {
  id: string;
  name: string;
  url: string;
  subtype?: 'storybook';
  width?: string;
  height?: string;
  createdAt: string;
  storybook?: StorybookMetadata;
}
