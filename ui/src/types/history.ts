/**
 * History Types - Types for document update history UI
 */

/**
 * A single change entry from the history API
 */
export interface ChangeEntry {
  /** ISO timestamp when the change occurred */
  timestamp: string;
  /** Diff details */
  diff: {
    oldString: string;
    newString: string;
  };
}

/**
 * Response from GET /api/document/:id/history
 */
export interface DocumentHistory {
  /** Original document content before any changes */
  original: string;
  /** Array of changes in chronological order */
  changes: ChangeEntry[];
}

/**
 * Props for the HistoryDropdown component
 */
export interface HistoryDropdownProps {
  /** Document ID to show history for */
  documentId: string;
  /** Current document content (for diff comparison) */
  currentContent: string;
  /** Callback when user selects a historical version */
  onVersionSelect: (timestamp: string, content: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Props for the HistoryModal component
 */
export interface HistoryModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close the modal */
  onClose: () => void;
  /** Historical content to show (left side of diff) */
  historicalContent: string;
  /** Current content to compare against (right side) */
  currentContent: string;
  /** Timestamp label for the historical version */
  timestamp: string;
  /** Optional document name for display */
  documentName?: string;
}

/**
 * Return type for useDocumentHistory hook
 */
export interface UseDocumentHistoryReturn {
  /** Document history data */
  history: DocumentHistory | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if failed */
  error: string | null;
  /** Refetch history */
  refetch: () => Promise<void>;
  /** Get content at a specific timestamp */
  getVersionAt: (timestamp: string) => Promise<string | null>;
}
