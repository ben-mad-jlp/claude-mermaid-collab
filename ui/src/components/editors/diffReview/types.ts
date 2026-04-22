export interface DiffHunk {
  startLine: number;
  endLine: number;
  removedLines: string[];
  addedLines: string[];
  proposalId: string;
  hunkIndex: number;
}

export interface ProposalState {
  hunks: DiffHunk[];
  proposedCode: string;
  message?: string;
  proposedBy: 'claude' | 'user';
  proposedAt: number;
}

export interface EditDecisionPayload {
  project: string;
  session: string;
  snippetId: string;
  action: 'accepted' | 'rejected';
  scope: 'whole-file' | 'hunk';
  hunkIndex?: number;
  filePath: string;
  proposedBy: string;
  decidedBy: 'user';
  proposedAt: number;
  message?: string;
  linesAdded: number;
  linesRemoved: number;
}
