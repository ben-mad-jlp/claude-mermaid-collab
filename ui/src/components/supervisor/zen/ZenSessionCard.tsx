import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import type { SessionSummary, Escalation } from '@/stores/supervisorStore';
import { type PlanTotals } from '@/components/supervisor/PlanTotals';
import { FUNNEL_SEGMENTS, STATUS_STYLE } from '@/components/supervisor/bridge/funnel';
import { ClaudePixAvatar } from '@/components/layout/SessionCard';

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
  /** Bring this session up in the full collab UI (sets current session + exits Zen). */
  onOpen: (project: string, session: string, serverId: string) => void;
}

/** Project bar: project name on the left; the plan funnel rollup + daemon totals as
 *  colored dot+count symbols, then an Open button, on the right. */
const STATUS_BAR_BG: Record<string, string> = {
  working: 'bg-success-500',
  active:  'bg-success-500',
  idle:    'bg-gray-300 dark:bg-gray-600',
  quiet:   'bg-gray-300 dark:bg-gray-600',
  stuck:   'bg-danger-500',
  wedged:  'bg-danger-500',
  stalled: 'bg-warning-400',
  'needs-input': 'bg-warning-400',
  unknown: 'bg-gray-300 dark:bg-gray-600',
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
  onOpen: (project: string, session: string, serverId: string) => void;
}> = ({ project, session, serverId, totals, daemon, size = 'sm', status = 'unknown', onOpen }) => {
  const name = project.split('/').pop() || project;
  // Project title scales with the card tier — it's the card's headline, so give it real weight.
  const titleSize = { xs: 'text-sm', sm: 'text-base', md: 'text-lg', lg: 'text-xl' }[size];
  const barBg = STATUS_BAR_BG[status] ?? STATUS_BAR_BG.unknown;
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700/60 rounded-t-2xl ${barBg}`}>
      <div className="flex items-center gap-2 min-w-0">
        {/* Dancing Claude in the corner — its animation reflects the session's state. */}
        <ClaudePixAvatar status={toPixStatus(status)} size={{ xs: 26, sm: 30, md: 36, lg: 42 }[size]} />
        <span className={`${titleSize} font-bold tracking-tight text-white truncate drop-shadow-sm`} title={project}>
          {name}
        </span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Plan totals — funnel buckets as colored dots */}
        {totals && totals.total > 0 && (
          <>
            {FUNNEL_SEGMENTS.map((seg) =>
              seg.key !== 'done' && totals.counts[seg.key] > 0 ? (
                <span key={seg.key} className="flex items-center gap-1 text-3xs font-medium" title={seg.label}>
                  <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                  <span className="text-white/90">{totals.counts[seg.key]}</span>
                </span>
              ) : null,
            )}
            <span className="text-3xs text-white/70">{totals.total} open</span>
          </>
        )}
        {/* Daemon totals — leaf-executor lanes (⚙ working / claimed / ⚠ permission) */}
        {daemon && daemon.lanes > 0 && (
          <span className="flex items-center gap-1.5 text-3xs font-medium pl-2 border-l border-white/30" title="Daemon lanes (working / claimed)">
            <span className="text-white/60">⚙</span>
            <span className="text-white/90">{daemon.working}</span>
            <span className="text-white/60">/ {daemon.lanes}</span>
            {daemon.permission > 0 && (
              <span className="text-white font-semibold" title="awaiting permission">⚠ {daemon.permission}</span>
            )}
          </span>
        )}
        {/* Open in full collab */}
        <button
          type="button"
          onClick={() => onOpen(project, session, serverId)}
          title="Open this session in the full collab"
          className="px-2 py-0.5 rounded-full text-3xs font-semibold text-white/80 hover:text-white hover:bg-white/20 transition-colors"
        >
          Open ↗
        </button>
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
  now = Date.now(),
  size = 'sm',
  expanded: expandedProp,
  onToggleExpand,
  onDecideEscalation,
  onAnswerPane,
  onOpen,
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
  useEffect(() => { setAction(null); }, [questionKey]);

  const runAnswer = async (chosen: string, label: string, fn: () => void | Promise<boolean>) => {
    if (action?.kind === 'pending') return;
    setAction({ kind: 'pending', label, chosen });
    try {
      const ok = await fn();
      // void-returning handlers (no result) are treated as fire-and-forget success.
      setAction({ kind: ok === false ? 'error' : 'sent', label, chosen });
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

  const sessionName = session.split('/').pop() || session;
  const structured = summary?.structured;
  const paragraph = (structured?.paragraph ?? summary?.summaryText ?? '').trim();
  // Glance: paragraph is ~2 sentences from the interpreter — sentence 1 = overall goal,
  // the rest = current task to get there. Put EACH sentence on its own line so the goal
  // and the current task read as distinct, with breathing room between them.
  const glance = (paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?/g) ?? [paragraph])
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
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

  // Status (interpreter status, else structural progressState) → a calm dot + label so
  // even a summary-less card conveys state at a glance.
  const status: string = structured?.status ?? summary?.progressState ?? 'unknown';
  const STATUS_META: Record<string, { dot: string; label: string }> = {
    working: { dot: 'bg-success-500', label: 'working' },
    active: { dot: 'bg-success-500', label: 'working' },
    idle: { dot: 'bg-gray-400', label: 'idle' },
    quiet: { dot: 'bg-gray-400', label: 'idle' },
    stuck: { dot: 'bg-danger-500', label: 'stuck' },
    wedged: { dot: 'bg-danger-500', label: 'stuck' },
    stalled: { dot: 'bg-warning-500', label: 'stalling' },
    'needs-input': { dot: 'bg-warning-500', label: 'needs you' },
    unknown: { dot: 'bg-gray-300 dark:bg-gray-600', label: 'unknown' },
  };
  const meta = STATUS_META[status] ?? STATUS_META.unknown;

  // Relative "updated Xm ago" from the interpreter write, so staleness is visible.
  const updatedAgo = (() => {
    const ts = summary?.summaryUpdatedAt;
    if (!ts) return null;
    const mins = Math.max(0, Math.floor((now - ts) / 60_000));
    return mins === 0 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  })();

  const tintStyle = freshnessStyle(summary?.summaryUpdatedAt, now);

  // The answer controls — shared by the question-fills-card layout. After a tap we show
  // a ✓ Sent confirmation in place of the buttons (covers the pane-answer case, where the
  // server pushes no state change, and the latency/failure gap on escalation decide).
  const answerArea = action?.kind === 'sent' ? (
    <div className={`${SZ.q} flex items-center justify-center gap-2 text-success-700 dark:text-success-400 font-medium`}>
      <span aria-hidden>✓</span>
      <span>Sent — “{action.label}”</span>
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
      <ProjectBar project={project} session={session} serverId={serverId} totals={totals} daemon={daemon} status={status} onOpen={onOpen} />

      {/* Body. When the session is ASKING, the question takes over the whole card (the
          summary is hidden) so the decision is the only thing in view. Otherwise the
          glance paragraph grows (FitText) to fill, click-to-expand to the fuller detail. */}
      <div className={`flex-1 min-h-0 flex flex-col items-stretch ${SZ.body}`}>
        <span className="shrink-0 flex items-center justify-center gap-1.5 text-3xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} title={meta.label} />
          {sessionName}
        </span>

        {hasQuestion ? (
          /* QUESTION FILLS THE CARD — the ask grows (FitText, flex-1 like the summary)
             to fill the space, with the answers pinned below it. */
          <div className="flex-1 min-h-0 flex flex-col gap-3 pt-1">
            <FitText text={questionText ?? ''} center className="text-gray-950 dark:text-white" />
            <div className="shrink-0 flex flex-col items-center gap-2">
              {answerArea}
            </div>
          </div>
        ) : paragraph ? (
          <button
            type="button"
            onClick={() => hasMore && toggleExpand()}
            title={hasMore ? (expanded ? 'Show less' : 'Show full description') : undefined}
            className={`flex-1 min-h-0 w-full flex flex-col ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
          >
            {expanded ? (
              <div className="flex-1 min-h-0 overflow-auto py-1">
                <p className="text-sm sm:text-base leading-snug text-gray-800 dark:text-gray-100 whitespace-pre-wrap text-left">
                  {expandedText}
                </p>
              </div>
            ) : (
              <FitText text={glance} className="text-gray-800 dark:text-gray-100" />
            )}
            {hasMore && (
              <span className="shrink-0 mt-1 text-3xs font-medium text-accent-600 dark:text-accent-400">
                {expanded ? 'less' : 'more'}
              </span>
            )}
          </button>
        ) : (
          <div className="flex-1 min-h-0">
            <FitText text="No summary yet" min={12} max={26} className="italic text-gray-400 dark:text-gray-500" />
          </div>
        )}

        {updatedAgo && !hasQuestion && (
          <span className="shrink-0 mt-1 text-3xs text-gray-300 dark:text-gray-600">updated {updatedAgo}</span>
        )}
      </div>
    </div>
  );
};

export default ZenSessionCard;
