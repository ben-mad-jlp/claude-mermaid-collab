import { create } from 'zustand';

/**
 * daemonPulseStore — a transient heartbeat: the timestamp of the last orchestrator
 * daemon tick (broadcast as `orchestrator_tick` each time the daemon wakes to poll).
 * The header's live dot subscribes and flashes briefly on each pulse, so the daemon
 * "waking up" is visible. Not persisted; purely ephemeral UI feedback.
 */
interface DaemonPulseState {
  lastTick: number;
  pulse: () => void;
}

export const useDaemonPulse = create<DaemonPulseState>((set) => ({
  lastTick: 0,
  pulse: () => set({ lastTick: Date.now() }),
}));
