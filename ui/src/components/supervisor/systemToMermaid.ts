// Pure generator for the PCS System Map (Phase 6): turn a flat list of role
// nodes (Supervisor → Planners → Coordinators → Workers) into a Mermaid
// flowchart, colored by live status, plus a node-id → session map so the view
// can wire click→open-tmux. The DATA derivation (subscriptionStore +
// session-status + roles) and the click handling live in the view; this is the
// testable core. Mirrors roadmapToMermaid.ts conventions.

export type SystemNodeKind = 'supervisor' | 'planner' | 'coordinator' | 'worker';
export type SystemNodeStatus =
  | 'running' | 'idle' | 'waiting' | 'permission' | 'escalation' | 'done' | 'unknown';

export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  label: string;
  status?: SystemNodeStatus;
  /** Parent node id (supervisor→planner→coordinator→worker). Omit for roots. */
  parentId?: string;
  /** For a worker: the todo it currently holds (annotated on the node). */
  heldTodo?: string;
  /** The collab session this node maps to, if any (for click→tmux). */
  session?: string;
}

const STATUS_CLASS: Record<SystemNodeStatus, string> = {
  running: 'running',
  idle: 'idle',
  waiting: 'waiting',
  permission: 'permission',
  escalation: 'escalation',
  done: 'done',
  unknown: 'unknown',
};

const CLASSDEFS = [
  '  classDef running fill:#dde5ff,stroke:#3366dd',
  '  classDef idle fill:#f4f4f5,stroke:#9ca3af',
  '  classDef waiting fill:#fff0d6,stroke:#e0a106',
  '  classDef permission fill:#ffe0e0,stroke:#dd3333',
  '  classDef escalation fill:#ffd6d6,stroke:#cc0000,stroke-width:2px',
  '  classDef done fill:#ddffdd,stroke:#33aa33',
  '  classDef unknown fill:#eee,stroke:#bbb,color:#999',
].join('\n');

// Node shape by role: supervisor/coordinator = hexagon/subroutine, planner =
// stadium, worker = rectangle. Keeps roles visually distinct in the map.
function shape(kind: SystemNodeKind, id: string, label: string): string {
  switch (kind) {
    case 'supervisor': return `${id}{{"${label}"}}`;
    case 'coordinator': return `${id}[["${label}"]]`;
    case 'planner': return `${id}(["${label}"])`;
    case 'worker': return `${id}["${label}"]`;
  }
}

function sanitizeId(id: string): string {
  let s = id.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s;
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

export interface SystemToMermaidResult {
  mermaid: string;
  /** sanitized node id → collab session (for click→open-tmux in the view). */
  nodeSessionMap: Record<string, string>;
}

export function systemToMermaid(nodes: SystemNode[]): SystemToMermaidResult {
  const lines: string[] = ['flowchart TD'];
  const nodeSessionMap: Record<string, string> = {};
  const known = new Set(nodes.map((n) => n.id));

  for (const n of nodes) {
    const sid = sanitizeId(n.id);
    const cls = STATUS_CLASS[n.status ?? 'unknown'] ?? 'unknown';
    const label = n.kind === 'worker' && n.heldTodo
      ? escapeLabel(`${n.label}\n▸ ${n.heldTodo}`)
      : escapeLabel(n.label);
    lines.push(`  ${shape(n.kind, sid, label)}:::${cls}`);
    if (n.session) nodeSessionMap[sid] = n.session;
  }
  // Hierarchy edges (only when the parent is a known node).
  for (const n of nodes) {
    if (n.parentId && known.has(n.parentId)) {
      lines.push(`  ${sanitizeId(n.parentId)} --> ${sanitizeId(n.id)}`);
    }
  }
  lines.push(CLASSDEFS);
  return { mermaid: lines.join('\n'), nodeSessionMap };
}
