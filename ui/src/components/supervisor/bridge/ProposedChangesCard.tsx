/**
 * ProposedChangesCard — the per-todo "Proposed changes" view (PAW 86b). The leaf-executor
 * persists the blueprint it wrote (with its trailing ```json size manifest) as a durable
 * collab document linked to the todo. This card re-reads that manifest and surfaces the two
 * file lists the human cares about BEFORE the work lands:
 *
 *   GET /api/leaf-executor/blueprint/:leafId?project=  →  { ran:false } | { manifest:{filesToCreate[],filesToEdit[]} }
 *
 * leafId === todoId (the executor sets both to leaf.id). Clones WorkerRunStrip's card chrome,
 * cancelled-flag fetch, and ws-nonce refetch (the existing `session_todos_updated` nudge — NO
 * new ws event, b2fe36b1). The manifest is static once written, so refetch on ws nudge + key
 * change only; NO poll. Renders NOTHING when there's no manifest or both lists are empty
 * ("ran/none → hidden"). ONE card language as WorkerRunStrip (329741da): create=green,
 * edit=amber, never red (red is reserved for failures).
 */
import React, { useEffect, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { apiFetch } from '@/lib/api';

interface BlueprintManifest {
  filesToCreate: string[];
  filesToEdit: string[];
}

interface BlueprintResponse {
  leafId: string;
  blueprintId?: string;
  ran?: boolean;
  manifest?: BlueprintManifest;
}

export const ProposedChangesCard: React.FC<{ leafId: string; project: string; serverId?: string }> = ({
  leafId,
  project,
  serverId = '',
}) => {
  const [manifest, setManifest] = useState<BlueprintManifest | null>(null);
  const [refetchNonce, setRefetchNonce] = useState(0);

  // Fetch (mirrors WorkerRunStrip's cancelled-flag shape). Re-runs on key change and on any
  // nonce bump (ws nudge). No poll — the manifest is static once the blueprint is written.
  useEffect(() => {
    let cancelled = false;
    apiFetch(
      serverId,
      `/api/leaf-executor/blueprint/${encodeURIComponent(leafId)}?project=${encodeURIComponent(project)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BlueprintResponse | null) => {
        if (cancelled) return;
        setManifest(d?.manifest ?? null);
      })
      .catch(() => {
        if (!cancelled) setManifest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [leafId, project, serverId, refetchNonce]);

  // ws nudge (only refresh path): the existing `session_todos_updated` broadcast already
  // reaches the Bridge. Bump the nonce on any such event → triggers the refetch. NO new event.
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated') setRefetchNonce((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, []);

  const filesToCreate = manifest?.filesToCreate ?? [];
  const filesToEdit = manifest?.filesToEdit ?? [];

  // ran/none → hidden: no manifest OR both lists empty renders nothing.
  if (filesToCreate.length === 0 && filesToEdit.length === 0) return null;

  return (
    <div
      data-testid="proposed-changes-card"
      className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40"
    >
      <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">proposed changes</span>
      </div>
      <div className="px-3 py-2.5 space-y-0.5">
        {filesToCreate.map((f) => (
          <FileRow key={`c-${f}`} path={f} prefix="+" color="text-green-600 dark:text-green-400" />
        ))}
        {filesToEdit.map((f) => (
          <FileRow key={`e-${f}`} path={f} prefix="~" color="text-amber-600 dark:text-amber-400" />
        ))}
      </div>
    </div>
  );
};

const FileRow: React.FC<{ path: string; prefix: string; color: string }> = ({
  path,
  prefix,
  color,
}) => (
  <div data-testid="proposed-file" className="flex items-center gap-1.5 text-2xs">
    {/* v1: static; future: grey when implement touches file (no reliable per-file signal yet). */}
    <span className="inline-block h-2.5 w-2.5 rounded-sm border border-gray-300 dark:border-gray-600 shrink-0" />
    <span className={`font-mono shrink-0 ${color}`}>{prefix}</span>
    <span className="font-mono text-gray-700 dark:text-gray-200 truncate" title={path}>
      {path}
    </span>
  </div>
);

export default ProposedChangesCard;
