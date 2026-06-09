/**
 * GlobalRoleSwitches — formerly housed the per-project Coordinator pill.
 * Now empty: the Orchestrator Ladder (OrchestratorLadder) in SupervisorPanel
 * owns per-project level control. Kept as a re-export shim so existing
 * CommandBar import doesn't break while the caller removes it.
 */
import React from 'react';

export interface GlobalRoleSwitchesProps {
  serverScope: string;
  project?: string;
}

/** @deprecated Use OrchestratorLadder per project instead. Returns null. */
export const GlobalRoleSwitches: React.FC<GlobalRoleSwitchesProps> = () => null;

export default GlobalRoleSwitches;
