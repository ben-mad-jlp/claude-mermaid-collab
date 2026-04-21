import type { AgentEvent } from './contracts.js';

export function summarizeLastTurn(events: AgentEvent[]): string {
  try {
    const lastTurnEndIdx = [...events].map((e, i) => ({ e, i })).reverse().find(({ e }) => e.kind === 'turn_end');
    if (!lastTurnEndIdx) return 'No recent activity.';

    const beforeTurnEnd = events.slice(0, lastTurnEndIdx.i + 1);

    const msgEvent = [...beforeTurnEnd].reverse().find(e => e.kind === 'assistant_message_complete');
    let textSnippet = '';
    if (msgEvent && msgEvent.kind === 'assistant_message_complete') {
      const raw = msgEvent.text ?? '';
      textSnippet = String(raw).replace(/[#*_`>[\]]/g, '').trim().slice(0, 120);
    }

    const toolEvent = [...beforeTurnEnd].reverse().find(e => e.kind === 'tool_call_started');
    if (toolEvent && toolEvent.kind === 'tool_call_started') {
      const name = toolEvent.name;
      const input = toolEvent.input;
      const firstArg = input && typeof input === 'object' ? String(Object.values(input as Record<string, unknown>)[0] ?? '').slice(0, 40) : '';
      const toolStr = firstArg ? `${name}(${firstArg.slice(0, 20)}…)` : `${name}(…)`;
      return textSnippet ? `${toolStr} → ${textSnippet}` : toolStr;
    }

    return textSnippet || 'No recent activity.';
  } catch {
    return 'Summary unavailable.';
  }
}
