import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import type { SessionSummary, Escalation } from '@/stores/supervisorStore';
import { type PlanTotals } from '@/components/supervisor/PlanTotals';
import { FUNNEL_SEGMENTS, STATUS_STYLE } from '@/components/supervisor/bridge/funnel';
import { ClaudePixAvatar, useElapsed } from '@/components/layout/SessionCard';
import { ZenPulseLine } from './ZenPulseLine';
import { ZenNextPanel } from './ZenNextPanel';
import { isPulsing, type PulseStage, type NextUp, type NextWork } from '@/lib/zenPulse';

// ZenSessionCard — the SINGLE Zen primitive (redesign 2026-06-20). One card per
// watched session: a project bar across the top (project + totals as symbols), a
// big centered progress paragraph, and — only when the session is asking — the
// question with selectable answers along the bottom. Nothing else; calm by default.

/** Per-project daemon (leaf-executor) rollup — derived from the fleet read-model. */
export interface DaemonTotals {
  /** Lanes actively running a node right now. */
  working: number;
  /** Claimed in-progress lanes (working + idle). */
  lanes: number;
  /** Lanes parked on a permission prompt. */
  permission: number;
}

export interface ZenSessionCardProps {
  project: string;
  session: string;
  serverId: string;
  summary?: SessionSummary;
  /** The project's plan rollup totals, shown as symbols in the top bar. */
  totals?: PlanTotals;
  /** The project's daemon (leaf-executor) totals, shown alongside the plan totals. */
  daemon?: DaemonTotals;
  /** Open escalation for THIS session, if any (structured options → decide). */
  escalation?: Escalation | null;
  /** Context-window fullness 0–100 → a thin loading bar under the header (like the
   *  watching cards). Undefined = no bar. */
  contextPercent?: number;
  /** Current epoch ms (from parent's ticking clock) — drives the freshness tint. */
  now?: number;
  /** Size tier — grows fonts/padding to fill space when few cards; shrinks others when
   *  one is expanded (focus + context). Default 'sm'. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Controlled expand (single-open accordion owned by ZenMode). If onToggleExpand is
   *  omitted the card falls back to its own local toggle. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  onDecideEscalation: (serverId: string, id: string, optionId: string) => void | Promise<boolean>;
  onAnswerPane: (serverId: string, project: string, session: string, value: string) => void | Promise<boolean>;
  /** Answer a multi-select question: toggle the chosen 1-based option numbers then submit. */
  onAnswerPaneMulti?: (serverId: string, project: string, session: string, numbers: number[]) => void | Promise<boolean>;
  /** The deterministic subscription status (active|waiting|permission|unknown) — the SAME
   *  signal the normal "watching" SessionCard colours from, so both UIs agree. Drives the
   *  header tint; the interpreter status is only a fallback when this is unknown. */
  subStatus?: 'active' | 'waiting' | 'permission' | 'unknown';
  /** Real activity heartbeat (subscription `lastUpdate`) — the SAME signal the watching
   *  SessionCard uses to show elapsed time + drive the amber activity pulse on `active`. */
  lastUpdate?: number;
  /** Subscription is stale (no fresh heartbeat) — dims the header tint, like the watching card. */
  stale?: boolean;
  /** Force a fresh summary (called shortly after answering so a lingering question
   *  clears once the session reacts, instead of waiting for the next cycle). */
  onRequestRefresh?: (serverId: string, project: string, session: string) => void;
  /** Bring this session up in the full collab UI (sets current session + exits Zen). */
  onOpen: (project: string, session: string, serverId: string) => void;
  /** Stop watching this session (unsubscribe) — renders an × in the header. */
  onClose?: () => void;
  /** Idle "Pulse" stage (off/paused → plain footer; settled/warm/glowing → the invitation). */
  stage?: PulseStage;
  /** Next-ready / blocked / empty work for this session's project (the Pulse chip). */
  nextUp?: NextUp;
  /** Grounded next-work candidates (ready leaves / epics / inbox) for the What's-Next panel. */
  nextWork?: NextWork;
  /** Sleep the Pulse for this idle episode. */
  onDismiss?: () => void;
}

/** Project bar: project name on the left; the plan funnel rollup + daemon totals as
 *  colored dot+count symbols, then an Open button, on the right. */
// Header tint by status — muted soft tints (not vivid fills), with dark text.
// Semantics MIRROR the normal "watching" SessionCard so a session reads the same
// colour in both UIs: AMBER = active/working, GREEN = waiting/at rest, RED = needs
// you (permission / question / stuck). Calm by default; the colour is a hint.
const STATUS_BAR_BG: Record<string, string> = {
  // subscription vocabulary (active|waiting|permission|unknown) — the watching card's source.
  // Stronger fills (300-level light / 500@35% dark) so the header colour reads clearly
  // against the white card body, matching the legibility of the normal watching card.
  active:     'bg-warning-300 dark:bg-warning-500/35',
  waiting:    'bg-success-300 dark:bg-success-500/35',
  permission: 'bg-danger-300 dark:bg-danger-500/35',
  // interpreter / progressState vocabulary (fallback when subscription status is unknown)
  working: 'bg-warning-300 dark:bg-warning-500/35',
  idle:    'bg-success-300 dark:bg-success-500/35',
  quiet:   'bg-success-300 dark:bg-success-500/35',
  done:    'bg-success-300 dark:bg-success-500/35',
  'needs-input': 'bg-danger-300 dark:bg-danger-500/35',
  stuck:   'bg-danger-300 dark:bg-danger-500/35',
  wedged:  'bg-danger-300 dark:bg-danger-500/35',
  stalled: 'bg-danger-300 dark:bg-danger-500/35',
  unknown: 'bg-gray-300 dark:bg-gray-600/40',
};

/** Map the Zen session status → the ClaudePix animation pool (active dances, etc.). */
function toPixStatus(status: string): string {
  if (status === 'working' || status === 'active') return 'active';
  if (status === 'needs-input') return 'permission';
  if (status === 'idle' || status === 'quiet') return 'waiting';
  return 'unknown'; // stuck / wedged / stalled / unknown
}

const ProjectBar: React.FC<{
  project: string;
  session: string;
  serverId: string;
  totals?: PlanTotals;
  daemon?: DaemonTotals;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  status?: string;
  stale?: boolean;
  elapsed?: string | null;
  onOpen: (project: string, session: string, serverId: string) => void;
  onClose?: () => void;
}> = ({ project, session, serverId, totals, daemon, size = 'sm', status = 'unknown', stale, elapsed, onOpen, onClose }) => {
  const name = project.split('/').pop() || project;
  const sessionShort = session.split('/').pop() || session;
  // Project title scales with the card tier — it's the card's headline, so give it real weight.
  const titleSize = { xs: 'text-sm', sm: 'text-base', md: 'text-lg', lg: 'text-xl' }[size];
  const barBg = STATUS_BAR_BG[status] ?? STATUS_BAR_BG.unknown;
  // Activity pulse — same `card-pulse-amber` the watching SessionCard uses while a session
  // is actively working. Stale (no fresh heartbeat) → dim the tint instead of pulsing.
  const pulse = status === 'active' && !stale ? 'card-pulse-amber' : '';
  const staleDim = stale && status !== 'unknown' ? 'opacity-60' : '';
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/60 rounded-t-2xl ${barBg} ${pulse} ${staleDim}`}>
      <div className="flex items-center gap-2 min-w-0">
        {/* Dancing Claude in the corner — its animation reflects the session's state. */}
        <ClaudePixAvatar status={toPixStatus(status)} size={{ xs: 26, sm: 30, md: 36, lg: 42 }[size]} />
        <span className={`${titleSize} font-bold tracking-tight text-gray-900 dark:text-gray-50 truncate`} title={`${project} / ${sessionShort}`}>
          {name}
          <span className="font-medium text-gray-500 dark:text-gray-400"> / {sessionShort}</span>
        </span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Plan totals — funnel buckets as colored dots */}
        {totals && totals.total > 0 && (
          <>
            {FUNNEL_SEGMENTS.map((seg) =>
              seg.key !== 'done' && totals.counts[seg.key] > 0 ? (
                <span key={seg.key} className="flex items-center gap-1 text-3xs font-medium" title={seg.label}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[seg.key].dot}`} />
                  <span className="text-gray-600 dark:text-gray-300">{totals.counts[seg.key]}</span>
                </span>
              ) : null,
            )}
            <span className="text-3xs text-gray-500 dark:text-gray-400">{totals.total} open</span>
          </>
        )}
        {/* Daemon totals — leaf-executor lanes (⚙ working / claimed / ⚠ permission) */}
        {daemon && daemon.lanes > 0 && (
          <span className="flex items-center gap-1.5 text-3xs font-medium pl-2 border-l border-gray-300 dark:border-gray-600" title="Daemon lanes (working / claimed)">
            <span className="text-gray-400 dark:text-gray-500">⚙</span>
            <span className="text-info-600 dark:text-info-400">{daemon.working}</span>
            <span className="text-gray-400 dark:text-gray-500">/ {daemon.lanes}</span>
            {daemon.permission > 0 && (
              <span className="text-warning-600 dark:text-warning-400 font-semibold" title="awaiting permission">⚠ {daemon.permission}</span>
            )}
          </span>
        )}
        {/* Activity — elapsed since the last heartbeat (same signal as the watching card). */}
        {elapsed && (
          <span className="text-3xs tabular-nums text-gray-600 dark:text-gray-300 shrink-0" title="Time since last activity">
            {elapsed}
          </span>
        )}
        {/* Open in full collab */}
        <button
          type="button"
          onClick={() => onOpen(project, session, serverId)}
          title="Open this session in the full collab"
          className="px-2 py-0.5 rounded-full text-3xs font-semibold text-gray-500 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          Open ↗
        </button>
        {/* Stop watching this session */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Stop watching this session"
            className="px-1.5 py-0.5 rounded-full text-sm leading-none font-semibold text-gray-400 dark:text-gray-500 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

/** Freshness wash for a recently-updated card: a soft light-blue tint laid OVER the
 *  card's real surface (an inset box-shadow, NOT a background — so it doesn't replace
 *  bg-white/dark:bg-gray-800 and make the card translucent). Full strength ≤ 2 min,
 *  linearly fading to nothing at 20 min, so a fresh update is obvious but never jarring.
 *  Works in both themes (a wash over white reads light-blue; over gray-800 reads a touch
 *  lighter). The base drop shadow is preserved so the card keeps its elevation. */
function freshnessStyle(updatedAt: number | undefined, now: number): React.CSSProperties {
  const baseShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
  if (!updatedAt) return { boxShadow: baseShadow };
  const ageMs = now - updatedAt;
  const FULL_MS = 2 * 60_000;
  const FADE_MS = 20 * 60_000;
  if (ageMs >= FADE_MS) return { boxShadow: baseShadow };
  const t = Math.min(1, Math.max(0, (FADE_MS - ageMs) / (FADE_MS - FULL_MS)));
  const opacity = (t * 0.14).toFixed(3); // max 14% wash — visible but calm
  return { boxShadow: `inset 0 0 0 9999px rgba(56, 189, 248, ${opacity}), ${baseShadow}` };
}

/** FitText — grows `text` to the largest font that fits the box in both dimensions.
 *  Measures in an off-screen absolute clone so the flex layout never shifts during the
 *  binary search, then commits the winning size as inline style on the real span. */
const FitText: React.FC<{ text: string; min?: number; max?: number; className?: string; center?: boolean }> = ({
  text,
  min = 13,
  max = 300,
  className,
  center,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const txtRef = useRef<HTMLSpanElement>(null);
  const [fs, setFs] = useState(min);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = txtRef.current;
    if (!box || !txt) return;
    const fit = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      if (!bw || !bh) return;

      // Measure in an absolute clone with a fixed width = box width, so the flex
      // layout is never disturbed and scrollHeight reflects true wrapped text height.
      const probe = document.createElement('span');
      probe.style.cssText = [
        'position:absolute', 'visibility:hidden', 'pointer-events:none',
        `width:${bw}px`, 'word-break:break-word', 'white-space:pre-line',
        `text-align:${center ? 'center' : 'left'}`, `line-height:${txt.style.lineHeight || '1.5'}`,
        `font-weight:${getComputedStyle(txt).fontWeight}`,
        `font-family:${getComputedStyle(txt).fontFamily}`,
      ].join(';');
      probe.textContent = text;
      document.body.appendChild(probe);

      let lo = min, hi = max, best = min;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        probe.style.fontSize = `${mid}px`;
        if (probe.scrollHeight <= bh && probe.scrollWidth <= bw + 1) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      document.body.removeChild(probe);

      txt.style.fontSize = `${best}px`;
      setFs(best);
    };
    fit();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(box);
    }
    return () => ro?.disconnect();
  }, [text, min, max]);

  return (
    <div ref={boxRef} className="flex-1 min-h-0 w-full flex flex-col justify-center overflow-hidden">
      <span
        ref={txtRef}
        style={{ fontSize: `${fs}px` }}
        className={`block w-full leading-[1.5] font-semibold break-words whitespace-pre-line ${center ? 'text-center' : 'text-left'} ${className ?? ''}`}
      >
        {text}
      </span>
    </div>
  );
};

export const ZenSessionCard: React.FC<ZenSessionCardProps> = ({
  project,
  session,
  serverId,
  summary,
  totals,
  daemon,
  escalation,
  contextPercent,
  now = Date.now(),
  size = 'sm',
  expanded: expandedProp,
  onToggleExpand,
  onDecideEscalation,
  onAnswerPane,
  onAnswerPaneMulti,
  subStatus,
  lastUpdate,
  stale,
  onRequestRefresh,
  onOpen,
  onClose,
  stage = 'off',
  nextUp,
  nextWork,
  onDismiss,
}) => {
  const [localExpanded, setLocalExpanded] = useState(false);
  const controlled = onToggleExpand != null;
  const expanded = controlled ? !!expandedProp : localExpanded;
  const toggleExpand = () => (controlled ? onToggleExpand!() : setLocalExpanded((e) => !e));

  // Click feedback for the answer buttons: the moment you tap, show pending; then a
  // ✓ Sent confirmation (or an error you can retry). decideEscalation clears the
  // escalation on success, but nudge (pane answers) changes no state, so without this
  // the card looked completely unresponsive. `chosen` highlights the tapped option.
  const [action, setAction] = useState<{ kind: 'pending' | 'sent' | 'error'; label: string; chosen: string } | null>(null);
  // A new/changed question (or escalation) resets the feedback so a stale ✓ never sticks.
  const escId = escalation?.id ?? null;
  const questionKey = `${escId}|${summary?.structured?.question ?? ''}|${summary?.structured?.status ?? ''}`;
  // Accumulated multi-select picks (1-based option numbers). Reset when the question changes.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => { setAction(null); setPicked(new Set()); }, [questionKey]);

  // "What's next" full-card takeover: opened from the Pulse invitation; auto-closes when
  // the session stops being idle (the Pulse stage drops out of its pulsing range) so an
  // active session always shows its summary again.
  const [nextOpen, setNextOpen] = useState(false);
  useEffect(() => { if (!isPulsing(stage)) setNextOpen(false); }, [stage]);

  const runAnswer = async (chosen: string, label: string, fn: () => void | Promise<boolean>) => {
    if (action?.kind === 'pending') return;
    setAction({ kind: 'pending', label, chosen });
    try {
      const ok = await fn();
      // void-returning handlers (no result) are treated as fire-and-forget success.
      const success = ok !== false;
      setAction({ kind: success ? 'sent' : 'error', label, chosen });
      // On success, force a fresh summary shortly after — give the session a moment to
      // react to the answer so the re-summarize sees the pane move past needs-input, and
      // the question doesn't linger until the next regular cycle.
      if (success && onRequestRefresh) {
        setTimeout(() => onRequestRefresh(serverId, project, session), 4000);
      }
    } catch {
      setAction({ kind: 'error', label, chosen });
    }
  };

  // Size tier → fonts + padding. Grows to fill space (few cards) and shrinks the
  // non-focused cards when one is expanded.
  const SZ = {
    xs: { body: 'px-4 py-3 gap-2', text: 'text-xs', q: 'text-xs', btn: 'px-3.5 py-1.5 text-sm' },
    sm: { body: 'px-5 py-4 gap-2.5', text: 'text-sm', q: 'text-sm', btn: 'px-4 py-2 text-base' },
    md: { body: 'px-8 py-7 gap-3', text: 'text-base', q: 'text-base', btn: 'px-5 py-2.5 text-lg' },
    lg: { body: 'px-10 py-10 gap-4', text: 'text-lg', q: 'text-lg', btn: 'px-6 py-3 text-xl' },
  }[size];

  const structured = summary?.structured;
  const paragraph = (structured?.paragraph ?? summary?.summaryText ?? '').trim();
  // Glance: the interpreter now writes the goal and the current task on their own lines
  // (a single \n it inserts itself), so we render the paragraph VERBATIM. We no longer
  // split on sentence punctuation client-side — that mis-broke on abbreviations like
  // "e.g." / "v6.7". FitText preserves the newlines (white-space: pre-line). Older cached
  // summaries that predate this simply render as one block.
  const glance = paragraph;
  // "more" reveals the LARGER summary: the interpreter's richer `detail` (distinct from the
  // glance), falling back to the full paragraph for entries summarized before `detail` existed.
  const detail = structured?.detail?.trim() ?? '';
  const expandedText = detail || paragraph;
  const hasMore = expandedText.length > glance.length;

  // A question is live when the interpreter flags needs-input OR an open escalation
  // carries options. Options come from the escalation (decide) or the pane (answer).
  const escOptions = escalation?.options ?? null;
  const paneOptions = structured?.options ?? null;
  const questionText =
    escalation?.questionText ?? structured?.question ?? (structured?.status === 'needs-input' ? 'Waiting for input' : null);
  const hasQuestion = !!questionText && ((escOptions && escOptions.length > 0) || (paneOptions && paneOptions.length > 0) || structured?.status === 'needs-input');
  // Multi-select pane question (Claude Code AskUserQuestion multiSelect): accumulate
  // picks then submit. Only when we can address options by single-digit number (≤9)
  // and a multi handler is wired; escalations are always single-decision.
  const multiSelect =
    !!structured?.multiSelect &&
    !escOptions &&
    !!paneOptions && paneOptions.length > 0 && paneOptions.length <= 9 &&
    !!onAnswerPaneMulti;

  // Status driving the header colour + dancing-Claude animation. To MIRROR the normal
  // "watching" SessionCard (same session → same colour in both UIs), prefer the
  // deterministic subscription status; a pending question always reads as needs-you (red);
  // fall back to the interpreter status / progressState only when the subscription
  // status is unknown.
  const status: string =
    hasQuestion
      ? 'permission'
      : subStatus && subStatus !== 'unknown'
        ? subStatus
        : structured?.status ?? summary?.progressState ?? 'unknown';

  // Activity: the SAME elapsed-since-heartbeat the watching SessionCard shows, driven by
  // the subscription `lastUpdate` (real session activity) — not the interpreter write.
  const elapsed = useElapsed(lastUpdate ?? 0, status, null);

  const tintStyle = freshnessStyle(summary?.summaryUpdatedAt, now);

  // Submit accumulated multi-select picks (1-based) as a single pane-multi answer.
  const submitMulti = async () => {
    if (picked.size === 0 || action?.kind === 'pending') return;
    const nums = Array.from(picked).sort((a, b) => a - b);
    const label = nums.map(n => paneOptions![n - 1].label).join(', ');
    await runAnswer('multi', label, () => onAnswerPaneMulti!(serverId, project, session, nums));
  };

  // The answer controls — shared by the question-fills-card layout. After a tap we show
  // a ✓ Sent confirmation in place of the buttons (covers the pane-answer case, where the
  // server pushes no state change, and the latency/failure gap on escalation decide).
  const answerArea = action?.kind === 'sent' ? (
    <div className={`${SZ.q} flex items-center justify-center gap-2 text-success-700 dark:text-success-400 font-medium`}>
      <span aria-hidden>✓</span>
      <span>Sent — “{action.label}”</span>
    </div>
  ) : multiSelect ? (
    <div className="w-full max-w-md mx-auto flex flex-col items-stretch gap-2">
      <div className="flex flex-col gap-1.5">
        {(paneOptions ?? []).map((opt, i) => {
          const n = i + 1;
          const on = picked.has(n);
          return (
            <button
              key={i}
              type="button"
              disabled={action?.kind === 'pending'}
              onClick={() =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (next.has(n)) next.delete(n); else next.add(n);
                  return next;
                })
              }
              className={`${SZ.btn} flex items-center gap-2 rounded-xl text-left font-medium transition-colors border disabled:opacity-50 ${
                on
                  ? 'border-accent-400 dark:border-accent-600 bg-accent-50 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border text-3xs leading-none ${
                  on ? 'bg-accent-500 border-accent-500 text-white' : 'border-gray-300 dark:border-gray-500'
                }`}
              >
                {on ? '✓' : ''}
              </span>
              <span className="flex-1 min-w-0">{opt.label}</span>
              {i === structured?.recommended && <span className="text-3xs text-accent-600 dark:text-accent-400 shrink-0">★</span>}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={picked.size === 0 || action?.kind === 'pending'}
        onClick={() => void submitMulti()}
        className={`${SZ.btn} self-center rounded-full font-semibold transition-colors border border-accent-300 dark:border-accent-700 bg-accent-600 text-white disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {action?.kind === 'pending' ? <span className="animate-pulse">…submitting</span> : `Submit${picked.size ? ` (${picked.size})` : ''}`}
      </button>
      {action?.kind === 'error' && (
        <span className="text-3xs font-medium text-danger-600 dark:text-danger-400 text-center">Couldn’t submit — try again.</span>
      )}
    </div>
  ) : (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {escOptions && escOptions.length > 0
          ? escOptions.map((opt) => {
              const recommended = escalation!.recommended === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={action?.kind === 'pending'}
                  onClick={() => runAnswer(opt.id, opt.label, () => onDecideEscalation(serverId, escalation!.id, opt.id))}
                  title={opt.detail ?? opt.label}
                  className={`${SZ.btn} rounded-full font-medium transition-colors border disabled:opacity-50 disabled:cursor-wait ${
                    recommended
                      ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {action?.kind === 'pending' && action.chosen === opt.id && <span className="mr-1 animate-pulse">…</span>}
                  {opt.label}
                  {recommended && <span className="ml-1 text-3xs text-accent-600 dark:text-accent-400">★</span>}
                </button>
              );
            })
          : multiSelect
          ? <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {(paneOptions ?? []).map((opt, i) => {
                  const num = i + 1;
                  const active = picked.has(num);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={action?.kind === 'pending'}
                      onClick={() => setPicked(prev => {
                        const next = new Set(prev);
                        if (next.has(num)) next.delete(num); else next.add(num);
                        return next;
                      })}
                      className={`${SZ.btn} rounded-full font-medium transition-colors border disabled:opacity-50 disabled:cursor-wait ${
                        active
                          ? 'border-accent-400 dark:border-accent-600 bg-accent-100 dark:bg-accent-800/50 text-accent-900 dark:text-accent-100'
                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {active && <span className="mr-1" aria-hidden>✓</span>}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={picked.size === 0 || action?.kind === 'pending'}
                onClick={submitMulti}
                className={`${SZ.btn} rounded-full font-semibold transition-colors border border-accent-400 dark:border-accent-600 bg-accent-500 dark:bg-accent-700 text-white disabled:opacity-40 disabled:cursor-wait hover:bg-accent-600 dark:hover:bg-accent-600`}
              >
                {action?.kind === 'pending' ? <span className="animate-pulse">…</span> : `Submit (${picked.size})`}
              </button>
            </>
          : (paneOptions ?? []).map((opt, i) => {
              const recommended = i === structured?.recommended;
              const chosenKey = `pane-${i}`;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={action?.kind === 'pending'}
                  onClick={() => runAnswer(chosenKey, opt.label, () => onAnswerPane(serverId, project, session, opt.valueToSend))}
                  className={`${SZ.btn} rounded-full font-medium transition-colors border disabled:opacity-50 disabled:cursor-wait ${
                    recommended
                      ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {action?.kind === 'pending' && action.chosen === chosenKey && <span className="mr-1 animate-pulse">…</span>}
                  {opt.label}
                  {recommended && <span className="ml-1 text-3xs text-accent-600 dark:text-accent-400">★</span>}
                </button>
              );
            })}
      </div>
      {action?.kind === 'error' && (
        <span className="text-3xs font-medium text-danger-600 dark:text-danger-400">Couldn’t send — tap to try again.</span>
      )}
    </>
  );

  return (
    <div
      data-testid="zen-session-card"
      style={tintStyle}
      className={`w-full h-full flex flex-col rounded-2xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-shadow transition-colors ${
        hasQuestion
          ? 'border-warning-300 dark:border-warning-700/70 ring-1 ring-warning-200 dark:ring-warning-900/40'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <ProjectBar project={project} session={session} serverId={serverId} totals={totals} daemon={daemon} status={status} stale={stale} elapsed={elapsed} onOpen={onOpen} onClose={onClose} />

      {/* Context-window fullness — a thin loading bar under the header, same thresholds
          as the watching cards (warn > 68%, danger + pulse > 78%). */}
      {contextPercent !== undefined && (
        <div className="h-1 w-full shrink-0 bg-black/10 dark:bg-white/10" title={`Context ${Math.round(contextPercent)}% full`}>
          <div
            className={`h-full transition-all ${
              contextPercent > 78 ? 'bg-danger-500 animate-pulse' : contextPercent > 68 ? 'bg-yellow-500' : 'bg-success-400/70'
            }`}
            style={{ width: `${Math.min(contextPercent, 100)}%` }}
          />
        </div>
      )}

      {/* Body. When the session is ASKING, the question takes over the whole card (the
          summary is hidden) so the decision is the only thing in view. Otherwise the
          glance paragraph grows (FitText) to fill, click-to-expand to the fuller detail. */}
      <div className={`flex-1 min-h-0 flex flex-col items-stretch ${SZ.body}`}>

        {hasQuestion ? (
          /* QUESTION FILLS THE CARD — the ask grows (FitText, flex-1 like the summary)
             to fill the space, with the answers pinned below it. */
          <div className="flex-1 min-h-0 flex flex-col gap-3 pt-1">
            <FitText text={questionText ?? ''} center className="text-gray-950 dark:text-white" />
            <div className="shrink-0 flex flex-col items-center gap-2">
              {answerArea}
            </div>
          </div>
        ) : nextOpen ? (
          /* "What's next" FILLS THE CARD — grounded next-work candidates + free text. */
          <ZenNextPanel
            nextWork={nextWork ?? { ready: [], epics: [], inbox: [] }}
            aiOption={null}
            action={action}
            onSend={(label, text) => runAnswer(`next:${label}`, label, () => onAnswerPane(serverId, project, session, text))}
            onPlan={() => onOpen(project, session, serverId)}
            onClose={() => setNextOpen(false)}
          />
        ) : paragraph ? (
          <button
            type="button"
            onClick={() => hasMore && toggleExpand()}
            title={hasMore ? (expanded ? 'Show less' : 'Show full description') : undefined}
            className={`group flex-1 min-h-0 w-full flex flex-col ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
          >
            {expanded ? (
              /* The fuller detail fills the card the same way the glance does — FitText
                 grows it to the largest font that fits (couple of paragraphs → it sizes
                 down to fill, no scroll), keeping the \n\n paragraph breaks the agent wrote. */
              <FitText text={expandedText} min={12} className="text-gray-800 dark:text-gray-100" />
            ) : (
              <FitText text={glance} className="text-gray-800 dark:text-gray-100" />
            )}
            {hasMore && (
              <span
                aria-label={expanded ? 'Show less' : 'Show more'}
                className="shrink-0 mt-1.5 self-center text-base leading-none font-semibold text-gray-800 dark:text-gray-100"
              >
                {expanded ? '−' : '+'}
              </span>
            )}
          </button>
        ) : (
          <div className="flex-1 min-h-0">
            <FitText text="No summary yet" min={12} max={26} className="italic text-gray-400 dark:text-gray-500" />
          </div>
        )}

        {/* Footer: the Pulse "ready for more" invitation when this idle session has warmed
            up (settled/warm/glowing). The elapsed timestamp now lives in the card header. */}
        {!hasQuestion && !nextOpen && isPulsing(stage) && (
          <ZenPulseLine
            stage={stage}
            nextUp={nextUp ?? { mode: 'empty' }}
            aiOption={null}
            action={action}
            onSend={(label, text) => runAnswer(`pulse:${label}`, label, () => onAnswerPane(serverId, project, session, text))}
            onExpand={() => setNextOpen(true)}
            onDismiss={onDismiss ?? (() => {})}
          />
        )}
      </div>
    </div>
  );
};

export default ZenSessionCard;
