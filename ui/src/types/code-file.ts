export interface UICodeFile {
  id: string;
  name: string;
  filePath: string;
  content: string;
  language: string;
  dirty: boolean;
  lastPushedAt: number | null;
  lastModified: number;
}
