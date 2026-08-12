import { describe, it, expect } from 'bun:test';
import {
  ExploreTurn,
  ExploreStallState,
  makeStallState,
  advanceStall,
  EXPLORE_STALL_LIMIT,
  isStalled,
  resolveExploreUsdLimits,
  DEFAULT_EXPLORE_SOFT_USD,
  DEFAULT_EXPLORE_HARD_USD,
  exploreBudgetStep,
  extractExploreTurns,
} from '../explore-budget';

describe('explore-budget: stall counter', () => {
  it('does not trip the stall counter on 20 distinct novel observations', () => {
    let state = makeStallState();

    // Feed 20+ distinct observations, one per turn.
    for (let i = 0; i < 20; i++) {
      const turn: ExploreTurn = {
        kind: 'tool-result',
        observations: [`observation-${i}`],
      };
      state = advanceStall(state, turn);
    }

    expect(state.stall).toBe(0);
    expect(isStalled(state)).toBe(false);
    expect(state.seen.size).toBe(20);
  });

  it('does not advance stall on reasoning-only turns', () => {
    let state = makeStallState();

    // Feed 10 reasoning turns.
    for (let i = 0; i < 10; i++) {
      const turn: ExploreTurn = { kind: 'reasoning' };
      state = advanceStall(state, turn);
    }

    expect(state.stall).toBe(0);
    expect(isStalled(state)).toBe(false);
  });

  it('trips isStalled after EXPLORE_STALL_LIMIT repeated-observation turns', () => {
    let state = makeStallState();

    // Feed one novel observation first.
    state = advanceStall(state, {
      kind: 'tool-result',
      observations: ['unique-obs'],
    });

    // Then feed the same observation EXPLORE_STALL_LIMIT times.
    for (let i = 0; i < EXPLORE_STALL_LIMIT; i++) {
      state = advanceStall(state, {
        kind: 'tool-result',
        observations: ['unique-obs'],
      });
    }

    expect(state.stall).toBe(EXPLORE_STALL_LIMIT);
    expect(isStalled(state)).toBe(true);
  });

  it('resets stall to 0 on one new observation after several stalled turns', () => {
    let state = makeStallState();

    // Feed one novel observation, then repeat it several times.
    state = advanceStall(state, {
      kind: 'tool-result',
      observations: ['obs-1'],
    });

    for (let i = 0; i < 5; i++) {
      state = advanceStall(state, {
        kind: 'tool-result',
        observations: ['obs-1'],
      });
    }

    expect(state.stall).toBeGreaterThan(0);
    expect(state.stall).toBeLessThan(EXPLORE_STALL_LIMIT);

    // Now feed a new observation.
    state = advanceStall(state, {
      kind: 'tool-result',
      observations: ['obs-2'],
    });

    expect(state.stall).toBe(0);
    expect(state.seen.has('obs-1')).toBe(true);
    expect(state.seen.has('obs-2')).toBe(true);
  });
});

describe('explore-budget: exploreBudgetStep decision table', () => {
  const limits = { softUsd: 10, hardUsd: 15 };

  it('covers exploreBudgetStep: continue, soft wrap-up, stalled wrap-up, hard-stop, and the spentUsd===hardUsd boundary', () => {
    // Case (a): low spend, not stalled, few segments → 'continue'
    let result = exploreBudgetStep({
      spentUsd: 5,
      limits,
      stall: makeStallState(),
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('continue');

    // Case (b): spentUsd >= softUsd but < hardUsd → 'wrap-up'
    result = exploreBudgetStep({
      spentUsd: 10,
      limits,
      stall: makeStallState(),
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('wrap-up');

    // Case (b2): spentUsd > softUsd but < hardUsd → 'wrap-up'
    result = exploreBudgetStep({
      spentUsd: 12,
      limits,
      stall: makeStallState(),
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('wrap-up');

    // Case (c): low spend but isStalled(stall) === true → 'wrap-up'
    const stalledState: ExploreStallState = { seen: new Set(), stall: EXPLORE_STALL_LIMIT };
    result = exploreBudgetStep({
      spentUsd: 5, // below soft
      limits,
      stall: stalledState,
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('wrap-up');

    // Case (c2): segmentsRun + 1 >= maxSegments → 'wrap-up'
    result = exploreBudgetStep({
      spentUsd: 5,
      limits,
      stall: makeStallState(),
      segmentsRun: 9,
      maxSegments: 10,
    });
    expect(result).toBe('wrap-up');

    // Case (d): spentUsd === hardUsd exactly (boundary) → 'hard-stop'
    result = exploreBudgetStep({
      spentUsd: 15,
      limits,
      stall: makeStallState(),
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('hard-stop');

    // Case (e): spentUsd > hardUsd → 'hard-stop'
    result = exploreBudgetStep({
      spentUsd: 20,
      limits,
      stall: makeStallState(),
      segmentsRun: 2,
      maxSegments: 10,
    });
    expect(result).toBe('hard-stop');

    // Precedence check: hard-stop takes precedence over wrap-up conditions
    result = exploreBudgetStep({
      spentUsd: 15, // at hardUsd
      limits,
      stall: stalledState, // also stalled
      segmentsRun: 9, // also near max
      maxSegments: 10,
    });
    expect(result).toBe('hard-stop');
  });
});

describe('explore-budget: extractExploreTurns', () => {
  it('extracts reasoning turns from assistant messages with text/thinking only', () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reasoning about the problem' },
          { type: 'thinking', thinking: 'Internal thought' },
        ],
      },
    });

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(1);
    expect(turns[0]).toEqual({ kind: 'reasoning' });
  });

  it('does not emit reasoning for assistant messages with tool_use blocks', () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'I will use a tool' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(0);
  });

  it('extracts tool-result turns with observations keyed by tool name and digest', () => {
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'file1.txt\nfile2.txt',
            },
          ],
        },
      }),
    ].join('\n');

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(1);
    expect(turns[0].kind).toBe('tool-result');
    if (turns[0].kind === 'tool-result') {
      expect(turns[0].observations.length).toBe(1);
      expect(turns[0].observations[0]).toContain('Bash:');
    }
  });

  it('ignores unparseable JSON lines gracefully', () => {
    const stdout = [
      'this is not JSON',
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Valid message' }],
        },
      }),
      'more garbage',
    ].join('\n');

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(1);
    expect(turns[0]).toEqual({ kind: 'reasoning' });
  });

  it('handles multiple tool_result blocks in a single user message', () => {
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 'tool-2', name: 'Grep', input: { command: 'grep' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'result1',
            },
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              content: 'result2',
            },
          ],
        },
      }),
    ].join('\n');

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(1);
    if (turns[0].kind === 'tool-result') {
      expect(turns[0].observations.length).toBe(2);
    }
  });

  it('caps output at MAX_TURNS', () => {
    const lines = [];
    // Generate 600 reasoning messages (exceed MAX_TURNS which is 500).
    for (let i = 0; i < 600; i++) {
      lines.push(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: `Message ${i}` }],
          },
        })
      );
    }
    const stdout = lines.join('\n');

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBeLessThanOrEqual(500);
  });

  it('collapses byte-identical tool results to the same observation key', () => {
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo' } },
          ],
        },
      }),
      // First user message with result.
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'same output',
            },
          ],
        },
      }),
      // Second assistant message.
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'echo' } },
          ],
        },
      }),
      // Second user message with identical result.
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              content: 'same output',
            },
          ],
        },
      }),
    ].join('\n');

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(2);
    if (turns[0].kind === 'tool-result' && turns[1].kind === 'tool-result') {
      // Both should have the same observation key since the content is identical.
      expect(turns[0].observations[0]).toBe(turns[1].observations[0]);
    }
  });

  it('does not emit tool-result turns with no valid tool_use_id correlation', () => {
    const stdout = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'unknown-tool-id', // no prior tool_use with this id
            content: 'orphaned result',
          },
        ],
      },
    });

    const turns = extractExploreTurns(stdout);
    expect(turns.length).toBe(0);
  });
});
