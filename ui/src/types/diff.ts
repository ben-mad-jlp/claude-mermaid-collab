export interface DiffState {
  showDiff: boolean;
  oldContent: string | null;
  newContent: string | null;
}

export interface DocumentHistory {
  previous: string | null;
  current: string;
  hasDiff: boolean;
}

export interface PatchNotification {
  type: 'patch';
  documentId: string;
  oldContent: string;
  newContent: string;
  patchApplied: {
    old_string: string;
    new_string: string;
  };
}
