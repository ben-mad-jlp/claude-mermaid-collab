/**
 * orchestrator-kick — a leaf decoupling seam so the todo-store can ask the
 * orchestrator to run a build tick NOW (event-driven claim path) without importing
 * orchestrator-live (which transitively imports the store → a cycle). The
 * orchestrator registers its kick at startup; mutation sites fire it. A no-op until
 * registered, so importing the store in isolation (tests) is side-effect-free.
 */
let kickHook: ((reason: string) => void) | null = null;

/** orchestrator-live registers its debounced kickOrchestrator here at startup. */
export function registerOrchestratorKick(fn: (reason: string) => void): void {
  kickHook = fn;
}

/** A mutation made a todo claimable — ask the orchestrator to tick now (best-effort;
 *  a missed kick is still serviced by the interval safety net). Never throws into
 *  the caller's mutation. */
export function fireOrchestratorKick(reason: string): void {
  try {
    kickHook?.(reason);
  } catch {
    /* a kick must never break the mutation that triggered it */
  }
}

let conductorKickHook: ((reason: string) => void) | null = null;

/** orchestrator-live registers its debounced kickConductor here at startup. */
export function registerConductorKick(fn: (reason: string) => void): void {
  conductorKickHook = fn;
}

/** A mutation produced a conductor-relevant event (leaf settled/parked/rejected, epic
 *  landed, criterion verdict) — ask the conductor to run now instead of waiting on the
 *  heartbeat. Never throws into the caller's mutation. */
export function fireConductorKick(reason: string): void {
  try {
    conductorKickHook?.(reason);
  } catch {
    /* a kick must never break the mutation that triggered it */
  }
}
