import { getEscalationDecision } from './supervisor-store.ts';

/** Result of awaiting a human decision on an escalation. `decided` and `timedOut`
 *  are mutually exclusive. */
export interface AwaitDecisionResult {
  escalationId: string;
  decided: boolean;
  timedOut: boolean;
  optionId: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — matches request_user_input
const DEFAULT_POLL_MS = 1500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

/**
 * Poll the escalation-decision store until a human posts an answer (via
 * POST /api/supervisor/escalation/:id/decide) or the timeout elapses. This is
 * the cross-process relay: the decide route and this poller may run in
 * different processes but share the on-disk supervisor.db, so polling — not an
 * in-memory bridge — is what links them. Deterministic/injectable clock + sleep
 * for tests.
 */
export async function awaitHumanDecision(
  escalationId: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<AwaitDecisionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const start = now();

  for (;;) {
    const d = getEscalationDecision(escalationId);
    if (d) {
      return {
        escalationId,
        decided: true,
        timedOut: false,
        optionId: d.optionId,
        note: d.note,
        decidedBy: d.decidedBy,
        decidedAt: d.decidedAt,
      };
    }
    if (now() - start >= timeoutMs) {
      return { escalationId, decided: false, timedOut: true, optionId: null, note: null, decidedBy: null, decidedAt: null };
    }
    // Don't oversleep past the deadline.
    const remaining = timeoutMs - (now() - start);
    await sleep(Math.max(1, Math.min(pollMs, remaining)));
  }
}
