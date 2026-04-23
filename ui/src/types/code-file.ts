export interface ProposedEdit {
  newCode: string;
  message?: string;
  proposedBy: string;
  proposedAt: number;
}

export interface UICodeFile {
  id: string;
  name: string;
  filePath: string;
  content: string;
  language: string;
  dirty: boolean;
  lastPushedAt: number | null;
  lastModified: number;
  proposedEdit?: ProposedEdit | null;
}

export interface DirectFileState {
  filePath: string;
  content: string;
  language: string;
}
