/** Precedence for the single keydown owner. Higher wins. */
export const KeyboardPriority = {
  RAIL: 10,
  SIGNALS: 20,
  FOCAL: 30,
} as const;

export type KeyboardPriorityValue = (typeof KeyboardPriority)[keyof typeof KeyboardPriority];

type Handler = (ev: KeyboardEvent) => void;

interface Owner {
  priority: number;
  seq: number;
  handler: Handler;
}

const owners = new Set<Owner>();
let listening = false;
let seqCounter = 0;

function dispatch(ev: KeyboardEvent) {
  let best: Owner | null = null;
  for (const o of owners) {
    if (!best || o.priority > best.priority) {
      best = o;
    }
  }
  best?.handler(ev);
}

function ensureListening() {
  if (listening) return;
  listening = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', dispatch);
  }
}

function maybeStopListening() {
  if (owners.size > 0) return;
  listening = false;
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', dispatch);
  }
}

import { useEffect, useRef } from 'react';

export function useKeyboardOwner(
  priority: KeyboardPriorityValue,
  handler: Handler,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const owner: Owner = {
      priority,
      seq: seqCounter++,
      handler: (ev) => handlerRef.current(ev),
    };

    owners.add(owner);
    ensureListening();

    return () => {
      owners.delete(owner);
      maybeStopListening();
    };
  }, [priority, enabled]);
}

export function __resetKeyboardOwners(): void {
  owners.clear();
  maybeStopListening();
}
