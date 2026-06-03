/**
 * EventStream — the reverse-chron fleet ticker/stream (Control-UI vision §4, §6).
 *
 * Two shapes share one body:
 *  - `collapsed`: a single-line ticker (the Studio liveness proof) showing the
 *    most-recent matching event.
 *  - full: a pinned NOW rail + severity filter chips
 *    [All · ⚠Needs me · Blocks · Activity] + a token-colored, highlight-fade
 *    reverse-chron list.
 *
 * Newly-inserted rows get a brief token-tinted highlight that fades, so the eye
 * catches arrivals without the list jumping. Insert detection is purely id-based
 * (a ref of previously-seen ids) — no timers needed to decide "new", only to
 * clear the highlight.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  matchesCategory,
  type StreamCategory,
  type StreamEvent,
} from '@/lib/eventTaxonomy';

export interface EventStreamProps {
  events: StreamEvent[];
  /** When set, only show events for this session (the Studio ticker). */
  filterSession?: string;
  /** Single-line ticker mode. */
  collapsed?: boolean;
  /** Row / selection click — opens the DrillDock in the Bridge. */
  onSelectEvent?: (event: StreamEvent) => void;
  className?: string;
}

interface Chip {
  key: StreamCategory | null;
  label: string;
}

const CHIPS: Chip[] = [
  { key: null, label: 'All' },
  { key: 'needs-me', label: '⚠ Needs me' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'activity', label: 'Activity' },
];

const HIGHLIGHT_MS = 1500;

function timeLabel(ts: number, now: number): string {
  const delta = Math.max(0, now - ts);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s`;
  const mnt = Math.floor(s / 60);
  if (mnt < 60) return `${mnt}m`;
  const h = Math.floor(mnt / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const EventRow: React.FC<{
  event: StreamEvent;
  now: number;
  highlighted: boolean;
  onSelect?: (e: StreamEvent) => void;
}> = ({ event, now, highlighted, onSelect }) => {
  const interactive = !!onSelect;
  const highlightCls = highlighted
    ? event.severity === 'danger'
      ? 'bg-danger-50/70 dark:bg-danger-900/30'
      : event.severity === 'warning'
        ? 'bg-warning-50/70 dark:bg-warning-900/30'
        : event.severity === 'success'
          ? 'bg-success-50/70 dark:bg-success-900/30'
          : event.severity === 'info'
            ? 'bg-info-50/70 dark:bg-info-900/30'
            : 'bg-gray-100/70 dark:bg-gray-800/40'
    : 'bg-transparent';
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? () => onSelect?.(event) : undefined}
      data-testid={`stream-row-${event.id}`}
      title={event.detail ?? event.title}
      className={`w-full flex items-start gap-1.5 px-2 py-1 text-left rounded transition-colors duration-700 ${highlightCls} ${
        interactive ? 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer' : 'cursor-default'
      }`}
    >
      <span className={`shrink-0 leading-tight ${event.tokenClass}`} aria-hidden="true">
        {event.icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-2xs leading-tight text-gray-800 dark:text-gray-200 truncate">
          {event.title}
        </span>
        {event.detail && (
          <span className="block text-3xs leading-tight text-gray-500 dark:text-gray-400 truncate">
            {event.detail}
          </span>
        )}
      </span>
      <span className="shrink-0 text-3xs tabular-nums text-gray-400 dark:text-gray-500 mt-0.5">
        {timeLabel(event.ts, now)}
      </span>
    </button>
  );
};

export const EventStream: React.FC<EventStreamProps> = ({
  events,
  filterSession,
  collapsed = false,
  onSelectEvent,
  className = '',
}) => {
  const [category, setCategory] = useState<StreamCategory | null>(null);
  // Tick so relative timestamps and "NOW" stay fresh.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Track which ids we've already rendered, to flag fresh inserts for the fade.
  const seenRef = useRef<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const sessionScoped = filterSession
      ? events.filter((e) => e.session === filterSession)
      : events;
    const catScoped = sessionScoped.filter((e) => matchesCategory(e, category));
    // newest first
    return [...catScoped].reverse();
  }, [events, filterSession, category]);

  useEffect(() => {
    const fresh: string[] = [];
    for (const e of filtered) {
      if (!seenRef.current.has(e.id)) {
        seenRef.current.add(e.id);
        fresh.push(e.id);
      }
    }
    if (fresh.length === 0) return;
    setHighlighted((cur) => {
      const next = new Set(cur);
      fresh.forEach((id) => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setHighlighted((cur) => {
        const next = new Set(cur);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [filtered]);

  if (collapsed) {
    const latest = filtered[0];
    return (
      <div
        data-testid="event-stream-ticker"
        className={`flex items-center gap-1.5 px-2 py-1 overflow-hidden ${className}`}
      >
        <span className="shrink-0 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
          live
        </span>
        {latest ? (
          <>
            <span className={`shrink-0 ${latest.tokenClass}`} aria-hidden="true">
              {latest.icon}
            </span>
            <span className="flex-1 min-w-0 text-2xs text-gray-700 dark:text-gray-300 truncate" title={latest.detail ?? latest.title}>
              {latest.title}
            </span>
            <span className="shrink-0 text-3xs tabular-nums text-gray-400 dark:text-gray-500">
              {timeLabel(latest.ts, now)}
            </span>
          </>
        ) : (
          <span className="flex-1 text-2xs text-gray-400 dark:text-gray-500 italic">
            quiet — no recent activity
          </span>
        )}
      </div>
    );
  }

  return (
    <div data-testid="event-stream" className={`flex flex-col min-h-0 ${className}`}>
      {/* Filter chips */}
      <div className="shrink-0 flex items-center gap-1 px-1 pb-1.5 flex-wrap">
        {CHIPS.map((chip) => {
          const active = category === chip.key;
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => setCategory(chip.key)}
              data-testid={`stream-chip-${chip.key ?? 'all'}`}
              className={`px-1.5 py-0.5 text-3xs font-medium rounded-full border transition-colors ${
                active
                  ? 'border-accent-300 dark:border-accent-700 bg-accent-100 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Pinned NOW rail */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-0.5 border-y border-dashed border-gray-200 dark:border-gray-700">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-pulse" aria-hidden="true" />
        <span className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          now
        </span>
      </div>

      {/* Reverse-chron list */}
      <div className="flex-1 min-h-0 overflow-y-auto py-0.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-2 text-2xs text-gray-400 dark:text-gray-500 italic">
            No events in this view yet.
          </p>
        ) : (
          filtered.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              now={now}
              highlighted={highlighted.has(e.id)}
              onSelect={onSelectEvent}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default EventStream;
