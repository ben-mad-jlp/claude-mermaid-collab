import type { AgentTimelineItem, AgentToolCallItem } from '@/stores/agentStore';

export type TimelineGroup = {
  type: 'group';
  id: string;
  kind: 'read' | 'grep';
  items: AgentToolCallItem[];
  commonPrefix?: string;
};

export type GroupedTimelineItem = AgentTimelineItem | TimelineGroup;

function commonDirPrefix(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const splits = paths.map((p) => p.split('/'));
  const first = splits[0];
  let prefixLen = first.length;
  for (let i = 1; i < splits.length; i++) {
    const cur = splits[i];
    let j = 0;
    while (j < prefixLen && j < cur.length && cur[j] === first[j]) {
      j++;
    }
    prefixLen = j;
    if (prefixLen === 0) break;
  }
  // Drop the last segment (assume last is filename when paths include file names)
  // Keep only directory segments that are fully shared.
  const segs = first.slice(0, prefixLen);
  const joined = segs.join('/');
  if (!joined || joined === '/') return null;
  return joined;
}

type Run = {
  kind: 'read' | 'grep';
  buffer: AgentToolCallItem[];
};

function isReadToolCall(item: AgentTimelineItem): item is AgentToolCallItem {
  if (item.type !== 'tool_call') return false;
  const tc = item as AgentToolCallItem;
  if (tc.name !== 'Read') return false;
  const input = tc.input as { file_path?: unknown } | undefined;
  return !!input && typeof input.file_path === 'string';
}

function isGrepToolCall(item: AgentTimelineItem): item is AgentToolCallItem {
  if (item.type !== 'tool_call') return false;
  const tc = item as AgentToolCallItem;
  return tc.name === 'Grep';
}

function readPaths(items: AgentToolCallItem[]): string[] {
  return items
    .map((it) => {
      const input = it.input as { file_path?: unknown } | undefined;
      return input && typeof input.file_path === 'string' ? input.file_path : '';
    })
    .filter((p) => p.length > 0);
}

export function groupTimeline(items: AgentTimelineItem[]): GroupedTimelineItem[] {
  const out: GroupedTimelineItem[] = [];
  let run: Run | null = null;

  const flush = () => {
    if (!run) return;
    const { kind, buffer } = run;
    if (buffer.length >= 3) {
      const first = buffer[0];
      const group: TimelineGroup = {
        type: 'group',
        id: `group-${first.id}`,
        kind,
        items: buffer,
      };
      if (kind === 'read') {
        const prefix = commonDirPrefix(readPaths(buffer));
        if (prefix) group.commonPrefix = prefix;
      }
      out.push(group);
    } else {
      for (const it of buffer) out.push(it);
    }
    run = null;
  };

  for (const item of items) {
    if (isReadToolCall(item)) {
      if (run && run.kind === 'read') {
        const candidatePaths = readPaths([...run.buffer, item]);
        const prefix = commonDirPrefix(candidatePaths);
        if (prefix) {
          run.buffer.push(item);
          continue;
        }
        flush();
      } else if (run) {
        flush();
      }
      run = { kind: 'read', buffer: [item] };
    } else if (isGrepToolCall(item)) {
      if (run && run.kind === 'grep') {
        run.buffer.push(item);
        continue;
      }
      if (run) flush();
      run = { kind: 'grep', buffer: [item] };
    } else {
      if (run) flush();
      out.push(item);
    }
  }

  if (run) flush();
  return out;
}
