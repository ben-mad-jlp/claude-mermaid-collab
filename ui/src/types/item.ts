/**
 * Unified item types for sidebar and editor components
 */

// Unified item type for sidebar (diagram, document, or design)
export interface Item {
  id: string;
  name: string;
  type: 'diagram' | 'document' | 'design';
  content: string;
  lastModified: number;
  folder?: string;
  locked?: boolean;
}

// Editor toolbar action
export interface ToolbarAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean; // Show in primary toolbar vs overflow
}
