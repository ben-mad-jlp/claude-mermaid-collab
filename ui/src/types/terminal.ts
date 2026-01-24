export interface TerminalConfig {
  wsUrl: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface TerminalState {
  connected: boolean;
  error: string | null;
}
