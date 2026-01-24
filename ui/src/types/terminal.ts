export interface TerminalConfig {
  wsUrl: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface TerminalState {
  connected: boolean;
  error: string | null;
}

// NEW: Tab-related types
export interface TerminalTab {
  id: string;
  name: string;
  wsUrl: string;
}

export interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}
