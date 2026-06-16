/**
 * Observability events — the no-black-box requirement (north-star §6) as a typed,
 * structured stream. Every phase emits phase-start/step/phase-end; each `step`
 * carries the tool calls + results + token usage. An adapter sinks these into the
 * live transcript + a model-call/cost ledger so a human can answer "what is this
 * worker doing, on what model, at what cost, with what result" without a server log.
 */
import type { SubloopRole } from './capabilities';

export interface PhaseUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ToolCallEvent {
  name: string;
  args: unknown;
}
export interface ToolResultEvent {
  name: string;
  result: string;
}

/** The routing decision for a phase — which (provider, model) ran and WHY (the
 *  default tier vs a WORKER_PROVIDER_<PHASE> config override). North-star §6: a human
 *  can SEE that e.g. blueprint=sonnet, implement=grok, and that implement was the
 *  default tier not an override. */
export interface PhaseRoute {
  provider: string;
  model: string;
  source: 'default' | 'override';
}

export type WorkerCoreEvent =
  | { type: 'phase-start'; role: SubloopRole; ts: number; model?: string; route?: PhaseRoute }
  | {
      type: 'step';
      role: SubloopRole;
      ts: number;
      model?: string;
      text?: string;
      toolCalls?: ToolCallEvent[];
      toolResults?: ToolResultEvent[];
      usage?: PhaseUsage;
    }
  | {
      type: 'phase-end';
      role: SubloopRole;
      ts: number;
      steps: number;
      text: string;
      parseError?: string;
      /** Which model ran this phase (for the cost ledger + routing visibility). */
      model?: string;
      /** The routing decision (provider + model + why) for this phase. */
      route?: PhaseRoute;
      /** Summed token usage across the phase's steps. */
      usage?: PhaseUsage;
      /** Estimated USD cost for this phase (0 if the model's price is unknown). */
      costUsd?: number;
    };

export type WorkerCoreEventSink = (e: WorkerCoreEvent) => void;

/** Cap a tool-result string so the transcript/ledger stays bounded. */
export const EVENT_RESULT_CAP = 1500;
