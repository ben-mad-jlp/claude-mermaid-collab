export type AgentStatus = 'working' | 'waiting' | 'idle';

export interface StatusState {
  status: AgentStatus;
  message?: string;
}

export interface StatusResponse {
  status: AgentStatus;
  message?: string;
  lastActivity: string;
}
