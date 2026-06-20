import { create } from 'zustand';

/**
 * freshnessStore — ephemeral heartbeat of the WS pipe itself. noteWsMessage() is
 * stamped on EVERY inbound WS message and on (re)connect, so consumers can tell
 * "the socket is alive" from "we've heard nothing in a while" (compare against
 * GONE_MS from subscriptionStore). Not persisted; purely transient UI signal.
 */
interface FreshnessState {
  lastWsMessageAt: number;
  noteWsMessage: () => void;
}

export const useFreshnessStore = create<FreshnessState>((set) => ({
  lastWsMessageAt: 0,
  noteWsMessage: () => set({ lastWsMessageAt: Date.now() }),
}));
