import { useEffect, useRef } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { useSupervisorStore, type Escalation, type ProgressState } from '@/stores/supervisorStore';
import { useDaemonPulse } from '@/stores/daemonPulseStore';
import { useFreshnessStore } from '@/stores/freshnessStore';

/**
 * useStatusSync — the single owner of status refresh
 * (design-ui-status-coherence §2). Mounted ONCE at the App root. Two mechanisms,
 * and deliberately NO interval / NO new WS event / NO polling (constraint
 * b2fe36b1):
 *
 *  (A) Incremental WS ingest. A single dispatcher folds the EXISTING events into
 *      the right slice:
 *        • escalation_created  → ingestEscalationCreated(esc) — upsert by id from
 *          the (enriched) broadcast payload, replacing App.tsx's blanket
 *          loadEscalations reload.
 *        • session_todos_updated → targeted loadProjectTodos(project) for the
 *          watched servers (already the Bridge behavior; centralized here so it is
 *          live app-wide, not only while the Bridge is mounted).
 *        • session_summary_updated → ingestSessionSummary(s) — fold the structural
 *          heartbeat (session-summary-loop.ts) into the sessionSummaries slice; the
 *          WS payload is complete so NO REST reload.
 *        • claude_session_*    → left to the existing useWatchEvents handler
 *          (subscriptionStore) — NOT duplicated here.
 *
 *  (B) Bootstrap hydrate. hydrateOpenEscalations(serverIds) runs ONCE on mount and
 *      ONCE per WS (re)connect (never on an interval). The store action is
 *      epoch-guarded (§2.1): it snapshots hydrateEpoch before its REST read and
 *      discards the result if a newer ingest/mutation/hydrate bumped the epoch
 *      meanwhile, so a slow reconnect snapshot can never clobber a newer WS upsert.
 *
 * @param serverIds the watched servers' ids (the App passes the live server set);
 *        an empty list falls back to 'local' inside the store action.
 */
export function useStatusSync(serverIds: string[]) {
  // Keep the latest server set in a ref so the long-lived onConnect / onMessage
  // handlers (registered once) always read the current list without being torn
  // down and re-registered on every server-list change.
  const serverIdsRef = useRef(serverIds);
  serverIdsRef.current = serverIds;

  // (B) Bootstrap + per-(re)connect hydrate.
  useEffect(() => {
    const client = getWebSocketClient();
    let cancelled = false;

    const hydrate = () => {
      if (cancelled) return;
      useFreshnessStore.getState().noteWsMessage();
      void useSupervisorStore.getState().hydrateOpenEscalations(serverIdsRef.current);
    };

    hydrate(); // once on mount
    const sub = client.onConnect(hydrate); // once per (re)connect
    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  }, []);

  // (A) WS ingest dispatcher.
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((message) => {
      useFreshnessStore.getState().noteWsMessage();
      const msg = message as { type?: string; project?: unknown; escalation?: unknown };
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'escalation_created': {
          // The broadcast carries the full escalation (enriched at the source);
          // fold it straight into openEscalations — no REST reload. If an older
          // server omits the payload we no-op here and rely on the next
          // bootstrap/reconnect hydrate to pick it up.
          const esc = msg.escalation as Escalation | undefined;
          if (esc && typeof esc.id === 'string') {
            useSupervisorStore.getState().ingestEscalationCreated(esc);
          }
          break;
        }
        case 'session_todos_updated': {
          const project = typeof msg.project === 'string' ? msg.project : '';
          if (!project) break;
          const ids = serverIdsRef.current.length ? serverIdsRef.current : ['local'];
          for (const id of ids) void useSupervisorStore.getState().loadProjectTodos(id, project);
          break;
        }
        case 'session_summary_updated': {
          const m = msg as {
            project?: unknown; session?: unknown; progressState?: unknown;
            paneSeenAt?: unknown; updatedAt?: unknown;
          };
          if (typeof m.project !== 'string' || typeof m.session !== 'string') break;
          if (typeof m.progressState !== 'string') break;
          useSupervisorStore.getState().ingestSessionSummary({
            project: m.project,
            session: m.session,
            progressState: m.progressState as ProgressState,
            paneSeenAt: typeof m.paneSeenAt === 'number' ? m.paneSeenAt : Date.now(),
            updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
          });
          break;
        }
        case 'orchestrator_tick': {
          // Daemon woke to poll — flash the header live dot.
          useDaemonPulse.getState().pulse();
          break;
        }
        // claude_session_* stay on the existing useWatchEvents handler.
        default:
          break;
      }
    });
    return () => sub.unsubscribe();
  }, []);
}
