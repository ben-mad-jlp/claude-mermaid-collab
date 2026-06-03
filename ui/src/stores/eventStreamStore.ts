/**
 * eventStreamStore — the in-memory ring buffer behind the EventStream
 * (Control-UI vision §4, §6).
 *
 * It accumulates normalized `StreamEvent`s from two existing sources:
 *  - LIVE: `pushFromWs(message)` is called from the App.tsx ws switch for every
 *    inbound message (no new ws events, no polling — it just observes).
 *  - BACKFILL: `backfillFromAudit(entries)` seeds history from
 *    supervisorStore.auditByProject on mount.
 *
 * Events are deduped by `id` so a live event and its later audit echo collapse
 * into one. The buffer is capped at CAPACITY (oldest dropped first), kept sorted
 * newest-last so the UI can cheaply reverse for reverse-chron display.
 */

import { create } from 'zustand';
import { fromAuditEntry, fromWsMessage, type StreamEvent } from '@/lib/eventTaxonomy';
import type { AuditEntry } from '@/stores/supervisorStore';

const CAPACITY = 500;

interface EventStreamState {
  events: StreamEvent[];
  /** Observe a live ws message; no-op if the taxonomy doesn't recognize it. */
  pushFromWs: (message: unknown) => void;
  /** Push an already-built event (used by tests / direct producers). */
  push: (event: StreamEvent) => void;
  /** Seed history from audit entries (merge + dedupe, never clobbers live). */
  backfillFromAudit: (entries: AuditEntry[]) => void;
  clear: () => void;
}

/** Insert/merge by id, keep sorted by ts ascending, cap at CAPACITY. */
function merge(existing: StreamEvent[], incoming: StreamEvent[]): StreamEvent[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, StreamEvent>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const sorted = Array.from(byId.values()).sort((a, b) => a.ts - b.ts);
  return sorted.length > CAPACITY ? sorted.slice(sorted.length - CAPACITY) : sorted;
}

export const useEventStreamStore = create<EventStreamState>((set, get) => ({
  events: [],

  pushFromWs: (message) => {
    const event = fromWsMessage(message);
    if (!event) return;
    set({ events: merge(get().events, [event]) });
  },

  push: (event) => {
    set({ events: merge(get().events, [event]) });
  },

  backfillFromAudit: (entries) => {
    if (!entries || entries.length === 0) return;
    const mapped = entries.map(fromAuditEntry);
    set({ events: merge(get().events, mapped) });
  },

  clear: () => set({ events: [] }),
}));
