/**
 * ConnectingConsole — a read-only console shown while the client is connecting
 * to the server. It surfaces every step the client takes (open socket, bootstrap
 * fetches, subscribes, reconnect attempts, errors) from the connectionLogStore, so
 * a programmer can SEE what's happening instead of staring at a bare spinner.
 *
 * Non-blocking: it overlays the app while `show` is true and disappears once
 * connected. Reappears on a reconnect (isConnecting flips true again).
 */
import React, { useEffect, useRef } from 'react';
import { useConnectionLogStore, type ConnLogStatus } from '@/stores/connectionLogStore';

const DOT: Record<ConnLogStatus, string> = {
  pending: 'text-warning-500',
  ok: 'text-success-500',
  error: 'text-danger-500',
  info: 'text-gray-400 dark:text-gray-500',
};

function ts(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export const ConnectingConsole: React.FC<{ show: boolean; error?: Error | null }> = ({ show, error }) => {
  const entries = useConnectionLogStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest line in view as steps stream in.
  useEffect(() => {
    if (show && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries, show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[34rem] max-w-[92vw] rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          {/* The collab brand mark — the pixel whale (same one on the desktop boot
              screen), gently bobbing while we connect. */}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg animate-bounce-slow"
            style={{
              background: 'linear-gradient(135deg, #3fb6a8, #2b8a80)',
              boxShadow: '0 6px 20px rgba(63, 182, 168, 0.30)',
            }}
            aria-hidden="true"
          >
            🐳
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Mermaid Collab</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Connecting to server…</div>
          </div>
          {error && <span className="ml-auto text-xs text-danger-600 dark:text-danger-400">{error.message}</span>}
        </div>
        {/* Read-only console — monospace, newest at the bottom. */}
        <div
          ref={scrollRef}
          data-testid="connecting-console"
          className="max-h-72 overflow-y-auto px-3 py-2 font-mono text-2xs leading-relaxed bg-gray-50 dark:bg-gray-950/40"
        >
          {entries.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500">waiting for the first step…</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-baseline gap-2 whitespace-pre-wrap break-words">
                <span className="text-gray-400 dark:text-gray-600 tabular-nums shrink-0">{ts(e.ts)}</span>
                <span className={`${DOT[e.status]} shrink-0`} aria-hidden="true">●</span>
                <span className="text-gray-700 dark:text-gray-200">{e.step}</span>
                {e.detail && <span className="text-gray-400 dark:text-gray-500">— {e.detail}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectingConsole;
