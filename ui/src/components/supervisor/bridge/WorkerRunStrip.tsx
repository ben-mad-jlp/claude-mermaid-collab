/**
 * WorkerRunStrip — the per-todo HEADLESS run view (PAW L?). The leaf-executor runs a
 * todo headlessly (blueprint→implement→review nodes) and creates NO tmux session, so
 * the lane-based fleet UI (LaneCallout/WorkerRunSummary) shows nothing for it. This strip
 * watches the headless run node-by-node via the P4a ledger aggregation:
 *
 *   GET /api/leaf-executor/run/:leafId  →  { ran:false } | { ran:true, ...LeafRunStats }
 *
 * leafId === todoId (the executor sets both to leaf.id), so the selected todo's id IS the
 * fetch key — no mapping. Mirrors WorkerRunSummary's fetch/cancel shape, card chrome, and
 * empty-state. Refresh is b2fe36b1-compliant (NO new ws event): refetch on the existing
 * `session_todos_updated` nudge PLUS a bounded 2.5s poll gated by (isActive && no terminal
 * outcome) so it stops dead once the run is terminal or the todo leaves in_progress.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';

interface LeafNode {
  nodeKind: string | null; // 'blueprint'|'implement'|'review'|null
  model: string;
  authMode: string | null;
  exitCode: number | null;
  durationMs: number | null;
  rateLimited: boolean | null;
  ts: number;
  verdict?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  outputText?: string | null; // the node's final message — shown when the chip is expanded
}

interface LeafRunResponse {
  ran: boolean;
  leafId: string;
  epicId?: string | null;
  project?: string;
  nodes?: LeafNode[];
  attempts?: number;
  nodesSpent?: number;
  nodeBudget?: number;
  budgetPct?: number;
  wallClockMs?: number;
  rateLimitedCount?: number;
  authModes?: Record<string, number>;
  finalOutcome?: 'accepted' | 'rejected' | 'pending' | 'blocked' | 'paused' | null;
  /** Atomic terminal record (from the outcome marker's outcomeDetail). */
  terminal?: {
    effectiveOutcome?: string;
    reviewVerdict?: 'pass' | 'fail' | null;
    pathTaken?: 'floor' | 'waves' | null;
    reason?: string;
    pendingReason?: string;
    gateReasons?: string[];
  } | null;
  reviewVerdict?: 'pass' | 'fail' | null;
}

const POLL_MS = 2500;

const NODE_LABEL: Record<string, string> = {
  blueprint: 'Blueprint',
  implement: 'Implement',
  review: 'Review',
  research: 'Research',
  wimplement: 'Implement',
  verify: 'Verify',
  fix: 'Fix',
};

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function outcomeBadge(outcome: LeafRunResponse['finalOutcome']): { text: string; cls: string } {
  switch (outcome) {
    case 'accepted':
      return { text: 'accepted', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
    case 'rejected':
    case 'blocked':
      return { text: outcome, cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
    case 'pending':
      // DISTINCT from rejected: review PASSed + work merged, the gate deferred. Not a failure.
      return { text: 'pending', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' };
    case 'paused':
      return { text: 'paused', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
    default:
      return { text: 'running', cls: 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
  }
}

function verdictBadge(verdict: LeafRunResponse['reviewVerdict']): { text: string; cls: string } | null {
  if (verdict == null) return null;
  if (verdict === 'pass')
    return { text: 'pass', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
  return { text: 'fail', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };
}

/**
 * dotClass — the per-node status dot. Reserve red for genuine failures only (329741da):
 * a running tail pulses accent; rate-limited is amber; exit 0 is green; a non-zero exit is
 * red; an unfinished node with no exit yet is a quiet grey pulse.
 */
function dotClass(node: LeafNode, isLast: boolean, isActive: boolean, hasTerminalOutcome: boolean): string {
  const running = isLast && isActive && !hasTerminalOutcome && node.exitCode == null;
  if (running) return 'bg-accent-500 animate-pulse';
  if (node.rateLimited === true) return 'bg-amber-500';
  if (node.exitCode === 0) return 'bg-green-500';
  if (node.exitCode != null && node.exitCode !== 0) return 'bg-red-500';
  // no exit yet, not the live tail → indeterminate
  return 'bg-gray-300 dark:bg-gray-600 animate-pulse';
}

export const WorkerRunStrip: React.FC<{ leafId: string; isActive: boolean }> = ({ leafId, isActive }) => {
  const [data, setData] = useState<LeafRunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Fetch (mirrors WorkerRunSummary's cancelled-flag shape). Re-runs on leafId change and
  // on any nonce bump (ws nudge or gated poll).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/leaf-executor/run/${encodeURIComponent(leafId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LeafRunResponse | null) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leafId, refetchNonce]);

  // ws nudge (primary): the existing `session_todos_updated` broadcast already reaches the
  // Bridge. Bump the nonce on any such event → triggers the refetch above. NO new event type.
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated') setRefetchNonce((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, []);

  // Bounded poll (fallback, only while genuinely live): a single headless node can take
  // minutes with no todo-status change, so ws alone is too coarse. Gate strictly on
  // (isActive && finalOutcome == null); stop the moment either flips false. No idle polling.
  const hasTerminalOutcome = data?.finalOutcome != null;
  const shouldPoll = isActive && !hasTerminalOutcome;
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => {
      if (shouldPollRef.current) setRefetchNonce((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll]);

  const nodes = data?.nodes ?? [];

  return (
    <div className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40">
      <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">headless run</span>
        {data?.ran ? (
          <div className="ml-auto flex items-center gap-2 text-2xs tabular-nums text-gray-600 dark:text-gray-300">
            <span title="attempt of max 2">attempt {data.attempts ?? 1}/2</span>
            <span className="text-gray-400">·</span>
            <span title="nodes spent of budget">
              {data.nodesSpent ?? nodes.length}/{data.nodeBudget ?? 20} nodes
            </span>
            <span className="text-gray-400">·</span>
            <span title="wall-clock">{fmtDuration(data.wallClockMs)}</span>
            {(() => {
              const b = outcomeBadge(data.finalOutcome);
              return (
                <span className={`text-3xs font-medium px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
              );
            })()}
            {(() => {
              const v = verdictBadge(data.reviewVerdict);
              return v ? (
                <span className={`text-3xs font-medium px-1.5 py-0.5 rounded ${v.cls}`} title="review verdict">
                  {v.text}
                </span>
              ) : null;
            })()}
          </div>
        ) : (
          <span className="ml-auto text-2xs text-gray-400 dark:text-gray-500 italic">
            {loading && !data ? 'loading…' : ''}
          </span>
        )}
      </div>

      {data?.ran ? (
        <div className="px-3 py-2.5">
          {(data.terminal?.pathTaken || data.terminal?.reason || data.terminal?.pendingReason) && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
              {data.terminal?.pathTaken && (
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5" title="execution path">
                  {data.terminal.pathTaken === 'waves' ? '🌊 waves' : '▏floor'}
                </span>
              )}
              {(data.terminal?.pendingReason ?? data.terminal?.reason) && (
                <span className="italic" title="terminal reason">
                  {data.terminal.pendingReason ?? data.terminal.reason}
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {nodes.map((node, i) => {
              const isLast = i === nodes.length - 1;
              const label = node.nodeKind ? NODE_LABEL[node.nodeKind] ?? node.nodeKind : 'node';
              const hasOutput = Boolean(node.outputText && node.outputText.trim());
              const isOpen = expanded === i;
              return (
                <button
                  key={`${node.ts}-${i}`}
                  type="button"
                  data-testid="run-node-chip"
                  onClick={() => setExpanded(isOpen ? null : hasOutput ? i : null)}
                  disabled={!hasOutput}
                  title={hasOutput ? 'Show node output' : 'No output captured'}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
                    isOpen
                      ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40'
                  } ${hasOutput ? 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-600' : 'cursor-default'}`}
                >
                  <span
                    data-testid="run-node-dot"
                    className={`h-2 w-2 rounded-full shrink-0 ${dotClass(node, isLast, isActive, hasTerminalOutcome)}`}
                  />
                  <span className="text-2xs font-medium text-gray-700 dark:text-gray-200">{label}</span>
                  {node.model && (
                    <span className="text-3xs text-gray-400 dark:text-gray-500 truncate max-w-[7rem]" title={node.model}>
                      · {node.model}
                    </span>
                  )}
                  {node.durationMs != null && (
                    <span className="text-3xs tabular-nums text-gray-400 dark:text-gray-500">
                      {fmtDuration(node.durationMs)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {expanded != null && nodes[expanded]?.outputText && (
            <div data-testid="run-node-output" className="mt-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-200 dark:border-gray-700">
                <span className="text-3xs font-medium text-gray-600 dark:text-gray-300">
                  {(nodes[expanded].nodeKind && NODE_LABEL[nodes[expanded].nodeKind!]) ?? 'node'} output
                </span>
                <span className="text-3xs tabular-nums text-gray-400 dark:text-gray-500">
                  {nodes[expanded].inputTokens ?? 0} in / {nodes[expanded].outputTokens ?? 0} out
                </span>
                <button type="button" onClick={() => setExpanded(null)} className="ml-auto text-3xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">close ✕</button>
              </div>
              <pre className="max-h-64 overflow-auto px-2 py-1.5 text-3xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">{nodes[expanded].outputText}</pre>
            </div>
          )}
        </div>
      ) : (
        data &&
        !loading && (
          <div className="px-3 py-3">
            <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No headless run yet.</p>
          </div>
        )
      )}
    </div>
  );
};

export default WorkerRunStrip;
