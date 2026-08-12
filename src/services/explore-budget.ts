/**
 * Pure explore-budget module: stall counter + soft/hard USD arithmetic + turn extraction.
 *
 * No I/O, no imports from leaf-executor.ts or node-commands.ts.
 * Mirrors the posture of node-commands.ts: pure domain logic for the executor to call.
 */

/**
 * Discriminated union type for explore turns.
 * 'reasoning' = assistant message with text/thinking blocks only (no tool calls).
 * 'tool-result' = tool_result block from a user message.
 */
export type ExploreTurn =
  | { kind: 'reasoning' }
  | { kind: 'tool-result'; observations: string[] };

/**
 * Stall detection state: tracks seen observations and consecutive stall counter.
 */
export interface ExploreStallState {
  seen: Set<string>;
  stall: number;
}

/**
 * Create initial stall state.
 */
export function makeStallState(): ExploreStallState {
  return { seen: new Set(), stall: 0 };
}

/**
 * Stall limit: after this many consecutive tool-result turns with zero novel observations,
 * the explore node is considered stalled.
 */
export const EXPLORE_STALL_LIMIT = 8;

/**
 * Check if the current stall state has reached the stall limit.
 */
export function isStalled(state: ExploreStallState): boolean {
  return state.stall >= EXPLORE_STALL_LIMIT;
}

/**
 * Pure stall-state transition.
 * - 'reasoning' turns do not advance the stall counter.
 * - 'tool-result' turns: if any observations are novel (not in seen), reset stall to 0 and add
 *   all novel observations to seen; otherwise increment stall.
 *
 * Does not mutate the input state; returns a new state object.
 */
export function advanceStall(state: ExploreStallState, turn: ExploreTurn): ExploreStallState {
  if (turn.kind === 'reasoning') {
    return state;
  }

  // turn.kind === 'tool-result'
  const novel = turn.observations.filter(o => !state.seen.has(o));

  if (novel.length > 0) {
    // Novel observations found: reset stall and add to seen.
    const newSeen = new Set(state.seen);
    for (const obs of novel) {
      newSeen.add(obs);
    }
    return { seen: newSeen, stall: 0 };
  }

  // No novel observations: increment stall.
  return { seen: state.seen, stall: state.stall + 1 };
}

/**
 * Default USD limits for explore operations.
 * Hard limit must be greater than soft limit.
 */
export const DEFAULT_EXPLORE_SOFT_USD = 10.0;
export const DEFAULT_EXPLORE_HARD_USD = 15.0;

/**
 * Resolve USD limits from environment variables, falling back to defaults.
 * Never throws on malformed input; clamps hardUsd to be at least softUsd.
 */
export function resolveExploreUsdLimits(env: Record<string, string | undefined>): {
  softUsd: number;
  hardUsd: number;
} {
  let softUsd = DEFAULT_EXPLORE_SOFT_USD;
  let hardUsd = DEFAULT_EXPLORE_HARD_USD;

  if (env.MERMAID_EXPLORE_SOFT_USD) {
    const parsed = Number.parseFloat(env.MERMAID_EXPLORE_SOFT_USD);
    if (Number.isFinite(parsed)) {
      softUsd = parsed;
    }
  }

  if (env.MERMAID_EXPLORE_HARD_USD) {
    const parsed = Number.parseFloat(env.MERMAID_EXPLORE_HARD_USD);
    if (Number.isFinite(parsed)) {
      hardUsd = parsed;
    }
  }

  // Clamp: hardUsd must be >= softUsd
  hardUsd = Math.max(hardUsd, softUsd);

  return { softUsd, hardUsd };
}

/**
 * Budget decision for the explore node.
 *
 * Order of checks:
 * 1. If spentUsd >= hardUsd → 'hard-stop'
 * 2. If spentUsd >= softUsd OR isStalled(stall) OR segmentsRun + 1 >= maxSegments → 'wrap-up'
 * 3. Otherwise → 'continue'
 */
export function exploreBudgetStep(input: {
  spentUsd: number;
  limits: { softUsd: number; hardUsd: number };
  stall: ExploreStallState;
  segmentsRun: number;
  maxSegments: number;
}): 'continue' | 'wrap-up' | 'hard-stop' {
  if (input.spentUsd >= input.limits.hardUsd) {
    return 'hard-stop';
  }

  if (
    input.spentUsd >= input.limits.softUsd ||
    isStalled(input.stall) ||
    input.segmentsRun + 1 >= input.maxSegments
  ) {
    return 'wrap-up';
  }

  return 'continue';
}

/**
 * Maximum number of turns to extract from explore node output.
 * Defensive cap, mirroring MAX_COMMANDS in node-commands.ts.
 */
const MAX_TURNS = 500;

/**
 * Extract explore turns from JSONL-formatted output.
 *
 * Line-scans the output, parsing each line as JSON. For each message:
 * - If msg.type === 'assistant' with text/thinking content only: emit 'reasoning' turn
 * - If msg.type === 'user' with tool_result blocks: emit 'tool-result' turn with observations
 *
 * tool_result observations are keyed by tool name and a normalized digest of the result content
 * so byte-identical repeated results collapse to the same observation key.
 */
export function extractExploreTurns(stdout: string): ExploreTurn[] {
  const turns: ExploreTurn[] = [];

  // Map tool_use id → tool name for correlating tool_result blocks.
  const toolUseNames = new Map<string, string>();

  for (const line of stdout.split('\n')) {
    if (turns.length >= MAX_TURNS) break;

    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore unparseable lines (truncated transcript)
    }

    // First pass: collect tool_use blocks to build the id → name map.
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          toolUseNames.set(block.id, block.name);
        }
      }

      // Check if this assistant message is reasoning-only (text/thinking, no tool_use).
      const hasContent =
        msg.message.content && msg.message.content.length > 0;
      const hasToolUse = msg.message.content?.some(
        (block: any) => block.type === 'tool_use'
      );
      const onlyReasoningTypes =
        msg.message.content?.every(
          (block: any) => block.type === 'text' || block.type === 'thinking'
        ) ?? false;

      if (hasContent && !hasToolUse && onlyReasoningTypes) {
        turns.push({ kind: 'reasoning' });
      }
    }

    // Second pass: extract tool_result blocks and emit observations.
    if (msg.type === 'user' && msg.message?.content) {
      const observations: string[] = [];

      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolName = toolUseNames.get(block.tool_use_id);
          if (!toolName) continue;

          // Digest the result content: normalize to a stable string.
          // Use JSON.stringify and truncate to 200 chars.
          const contentStr = JSON.stringify(block.content);
          const digest = contentStr.slice(0, 200);
          const observationKey = `${toolName}:${digest}`;

          observations.push(observationKey);
        }
      }

      if (observations.length > 0) {
        turns.push({ kind: 'tool-result', observations });
      }
    }
  }

  return turns;
}
