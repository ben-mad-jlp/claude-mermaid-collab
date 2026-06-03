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
}

export const StreamTicker: React.FC<StreamTickerProps> = ({ events }) => (
  <div
    data-testid="bridge-stream-ticker"
    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 flex flex-col min-h-[8rem] max-h-56"
  >
    <div className="shrink-0 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      Stream
    </div>
    <EventStream events={events} className="flex-1 min-h-0" />
  </div>
);

export default StreamTicker;
