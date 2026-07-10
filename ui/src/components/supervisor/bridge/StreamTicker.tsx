/**
 * StreamTicker — a thin EventStream wrapper for the bottom of the Bridge
 * instrument panel (BR-2, design §2/§8).
 *
 * It frames the shared fleet EventStream in a short, calm card so the panel
 * keeps a heartbeat without competing with NeedsYou / Vitals / Roster above it.
 */

import React from 'react';
import { EventStream } from '@/components/stream/EventStream';
import type { StreamEvent } from '@/lib/eventTaxonomy';

export interface StreamTickerProps {
  events: StreamEvent[];
  /** Render body-only (no card chrome / header) for use inside a tab panel. */
  embedded?: boolean;
  /** Single-line ticker mode — forwards to EventStream's collapsed branch; overrides the card chrome. */
  collapsed?: boolean;
  /** Click an event → jump to what it's about (e.g. its todo's detail). Forwarded to
   *  EventStream, which renders rows clickable when set. */
  onSelectEvent?: (event: StreamEvent) => void;
  /** todoId→title map so thin todo-lifecycle events show what they're about. */
  titleByTodoId?: Map<string, string>;
}

export const StreamTicker: React.FC<StreamTickerProps> = ({ events, embedded, collapsed, onSelectEvent, titleByTodoId }) => {
  if (collapsed) return <EventStream events={events} collapsed titleByTodoId={titleByTodoId} />;
  if (embedded) return <EventStream events={events} className="min-h-0" onSelectEvent={onSelectEvent} titleByTodoId={titleByTodoId} />;
  return (
    <div
      data-testid="bridge-stream-ticker"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 flex flex-col min-h-[8rem] max-h-56"
    >
      <div className="shrink-0 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Stream
      </div>
      <EventStream events={events} className="flex-1 min-h-0" onSelectEvent={onSelectEvent} />
    </div>
  );
};

export default StreamTicker;
