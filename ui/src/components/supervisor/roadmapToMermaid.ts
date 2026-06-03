import type { PlanItem } from '@/types/planItem';

export interface RoadmapToMermaidOpts {
  mode?: 'graph' | 'waves';
}

const STATUS_CLASS: Record<string, string> = {
  done: 'done',
  completed: 'done',
  in_progress: 'inprogress',
  inprogress: 'inprogress',
  ready: 'ready',
  planned: 'planned',
  blocked: 'blocked',
  dropped: 'dropped',
};

const CLASSDEFS = [
  '  classDef done fill:#ddffdd,stroke:#33aa33',
  '  classDef inprogress fill:#dde5ff,stroke:#3366dd',
  '  classDef ready fill:#f4f4f5,stroke:#9ca3af',
  '  classDef planned fill:#f4f4f5,stroke:#9ca3af,stroke-dasharray:4',
  '  classDef blocked fill:#fff0d6,stroke:#e0a106',
  '  classDef dropped fill:#eee,stroke:#bbb,color:#999',
].join('\n');

export function sanitizeId(id: string): string {
  let s = id.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s;
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

function nodeLine(item: PlanItem, indent: string): string {
  const cls = STATUS_CLASS[item.status] ?? 'planned';
  return `${indent}${sanitizeId(item.id)}["${escapeLabel(item.title)}"]:::${cls}`;
}

function edgeLines(items: PlanItem[]): string[] {
  const ids = new Set(items.map((i) => sanitizeId(i.id)));
  const lines: string[] = [];
  for (const item of items) {
    for (const dep of item.dependsOn ?? []) {
      const from = sanitizeId(dep);
      if (ids.has(from)) lines.push(`  ${from} --> ${sanitizeId(item.id)}`);
    }
  }
  return lines;
}

export function computeWaveMap(items: PlanItem[]): Map<string, number> {
  const idSet = new Set(items.map((i) => i.id));
  const waveMap = new Map<string, number>();
  for (const item of items) waveMap.set(item.id, 0);
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const item of items) {
      const deps = (item.dependsOn ?? []).filter((d) => idSet.has(d) && d !== item.id);
      if (deps.length === 0) continue;
      const maxDepWave = Math.max(...deps.map((d) => waveMap.get(d) ?? 0));
      const desired = maxDepWave + 1;
      if ((waveMap.get(item.id) ?? 0) < desired) {
        waveMap.set(item.id, desired);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return waveMap;
}

export function roadmapToMermaid(items: PlanItem[], opts?: RoadmapToMermaidOpts): string {
  if (!items || items.length === 0) {
    return 'flowchart TD\n  empty["No roadmap items"]';
  }
  const mode = opts?.mode ?? 'graph';
  const edges = edgeLines(items);
  const out: string[] = ['flowchart TD', CLASSDEFS, ''];

  if (mode === 'waves') {
    const waveMap = computeWaveMap(items);
    const byWave = new Map<number, PlanItem[]>();
    for (const item of items) {
      const w = waveMap.get(item.id) ?? 0;
      const arr = byWave.get(w) ?? [];
      arr.push(item);
      byWave.set(w, arr);
    }
    for (const w of Array.from(byWave.keys()).sort((a, b) => a - b)) {
      out.push(`  subgraph wave_${w}["Wave ${w}"]`);
      for (const item of byWave.get(w)!) out.push(nodeLine(item, '    '));
      out.push('  end');
    }
  } else {
    const byId = new Map(items.map((i) => [i.id, i]));
    const childrenByParent = new Map<string, PlanItem[]>();
    const topLevel: PlanItem[] = [];
    for (const item of items) {
      const pid = item.parentId;
      if (pid && byId.has(pid)) {
        const arr = childrenByParent.get(pid) ?? [];
        arr.push(item);
        childrenByParent.set(pid, arr);
      } else {
        topLevel.push(item);
      }
    }
    for (const item of topLevel) {
      if (childrenByParent.has(item.id)) continue;
      out.push(nodeLine(item, '  '));
    }
    for (const [pid, children] of childrenByParent) {
      const parent = byId.get(pid);
      const label = escapeLabel(parent ? parent.title : pid);
      out.push(`  subgraph ${sanitizeId(pid)}["${label}"]`);
      for (const child of children) out.push(nodeLine(child, '    '));
      out.push('  end');
    }
  }

  out.push('');
  out.push(...edges);
  return out.join('\n') + '\n';
}
