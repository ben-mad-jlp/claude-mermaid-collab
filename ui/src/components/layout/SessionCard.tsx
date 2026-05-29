/**
 * SessionCard — the shared status card used by both the "Watching"
 * (SubscriptionsPanel) and "Supervisor" (SupervisorPanel) sidebar sections.
 *
 * The card and its click side-effects (create terminal, focus browser tab,
 * open the terminal store) are identical across both panels so a supervised
 * card behaves exactly like a watched one. Variant-specific affordances are
 * opt-in via props:
 *   - Watching: pass `onUnsubscribe` + the drag handlers + `draggable`.
 *   - Supervisor: pass `locked` / `escalated` to show the inline indicators.
 * The supervise toggle (shield) is always shown — in the supervisor panel it
 * is green and acts as the "stop supervising" button.
 */
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBrowserStore } from '@/stores/browserStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { ServerIcon } from '@/components/ServerIcon';

const CLAUDE_PIX_BASE = '/claudepix';

export const capsCache = new Map<string, { tmux: boolean }>();
export async function fetchCapabilities(serverId: string): Promise<{ tmux: boolean }> {
  if (capsCache.has(serverId)) return capsCache.get(serverId)!;
  const mc = (window as any).mc;
  if (!mc?.getServerCapabilities) return { tmux: true }; // browser fallback: same-origin to its own server
  // Optimistic on failure/nullish: let the call happen — the server response
  // will flip caps off if tmux truly isn't available.
  const caps = (await mc.getServerCapabilities(serverId).catch(() => null)) ?? { tmux: true };
  capsCache.set(serverId, caps);
  return caps;
}

const ANIMATIONS: Record<string, string[]> = {
  active:     ['work_coding.html', 'dance_bounce_dj.html', 'dance_sway_dj.html', 'dance_djmix.html'],
  waiting:    ['expression_wink.html', 'expression_sleep.html', 'idle_breathe.html', 'idle_blink.html', 'idle_look_around.html'],
  permission: ['expression_surprise.html', 'dance_bounce.html'],
  unknown:    ['idle_breathe.html', 'idle_blink.html', 'idle_look_around.html'],
};

function pickAnimation(status: string): string {
  const pool = ANIMATIONS[status] ?? ANIMATIONS.unknown;
  return `${CLAUDE_PIX_BASE}/${pool[Math.floor(Math.random() * pool.length)]}`;
}

export const ClaudePixAvatar: React.FC<{ status: string }> = ({ status }) => {
  const [src] = useState(() => pickAnimation(status));
  const prevStatus = useRef(status);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      setCurrentSrc(pickAnimation(status));
    }
  }, [status]);

  return (
    <>
      <div
        className="flex-shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        title="Click to expand"
      >
        <iframe
          src={currentSrc}
          title="Claude"
          scrolling="no"
          frameBorder="0"
          sandbox="allow-scripts"
          className="rounded-sm overflow-hidden pointer-events-none"
          style={{ width: 44, height: 44, imageRendering: 'pixelated', background: 'transparent', display: 'block' }}
        />
      </div>

      {expanded && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setExpanded(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <iframe
              src={currentSrc}
              title="Claude (expanded)"
              scrolling="no"
              frameBorder="0"
              sandbox="allow-scripts"
              style={{ width: '80vmin', height: '80vmin', imageRendering: 'pixelated', background: 'transparent', display: 'block' }}
            />
            <button
              onClick={() => setExpanded(false)}
              className="absolute -top-4 -right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return '>1h';
}

export function useElapsed(lastUpdate: number, status: string): string | null {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status === 'unknown') return;
    const elapsed = Date.now() - lastUpdate;
    if (elapsed >= 3_600_000) return; // already >1h, no need to keep ticking
    const interval = elapsed < 60_000 ? 1_000 : 60_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [lastUpdate, status, now]);

  if (status === 'unknown') return null;
  return formatElapsed(now - lastUpdate);
}

export interface SessionCardData {
  serverId: string;
  project: string;
  session: string;
  claudeSessionId?: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

/**
 * Fire the click side-effects for a card: create a terminal on the row's
 * server (if it supports tmux), focus its browser tab, and open the terminal
 * store. Per-server IPC keeps the "active server" unchanged when clicking an
 * off-active row. Shared so Watching and Supervisor behave identically.
 */
export async function activateSessionCard(sub: SessionCardData, serverLabel?: string): Promise<void> {
  const mc = (window as any).mc;
  const caps = await fetchCapabilities(sub.serverId);
  if (caps.tmux) {
    if (mc?.invokeOnServer) {
      void mc.invokeOnServer(sub.serverId, {
        path: '/api/ide/create-terminal',
        method: 'POST',
        body: { session: sub.session, project: sub.project },
      });
    } else {
      fetch('/api/ide/create-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sub.session, project: sub.project }),
      }).catch(() => {});
    }
  }
  // Always fire browser focus — not gated by tmux capability.
  if (mc?.invokeOnServer) {
    void mc.invokeOnServer(sub.serverId, {
      path: '/api/browser/focus-tab',
      method: 'POST',
      body: { session: sub.session },
    });
  } else {
    fetch('/api/browser/focus-tab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sub.session }),
    }).catch(() => {});
  }
  useBrowserStore.getState().activateSession(sub.session);
  void useTerminalStore.getState().openFor(sub.project, sub.session, {
    serverId: sub.serverId,
    serverLabel,
  });
}

export const SessionCard: React.FC<{
  sub: SessionCardData;
  serverLabel?: string;
  serverIcon?: string;
  onNavigate: (sub: SessionCardData) => void;
  isSelected: boolean;
  supervised: boolean;
  onToggleSupervise: (sub: SessionCardData, next: boolean) => void;
  // Watching-only affordances
  subKey?: string;
  onUnsubscribe?: (key: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, key: string) => void;
  onDragOver?: (e: React.DragEvent, key: string) => void;
  onDragEnd?: () => void;
  isDragOver?: boolean;
}> = ({
  sub,
  serverLabel,
  serverIcon,
  onNavigate,
  isSelected,
  supervised,
  onToggleSupervise,
  subKey,
  onUnsubscribe,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragOver,
}) => {
  const elapsed = useElapsed(sub.lastUpdate, sub.status);

  const statusBg =
    sub.status === 'permission'
      ? 'bg-red-300 hover:bg-red-400 border border-red-500'
      : sub.status === 'active'
        ? 'card-pulse-amber border border-amber-400'
        : sub.status === 'waiting'
          ? 'bg-green-300 hover:bg-green-400 border border-green-500'
          : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';

  const ctx = sub.contextPercent;
  const ctxHigh = ctx !== undefined && ctx > 78;
  const ctxWarn = ctx !== undefined && ctx > 68 && ctx <= 78;

  return (
    <div className={`flex items-center gap-1 ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}`}>
      {/* Colored status card */}
      <div
        className={`relative group flex-1 flex items-stretch gap-2 pl-3 pr-2 py-1 rounded text-sm cursor-pointer transition-colors min-w-0 overflow-hidden ${statusBg} ${ctxHigh ? 'ring-2 ring-red-500 ring-inset' : ''}`}
        draggable={draggable}
        onDragStart={draggable && subKey ? (e) => onDragStart?.(e, subKey) : undefined}
        onDragOver={draggable && subKey ? (e) => onDragOver?.(e, subKey) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onClick={async () => {
          // Per-server IPC: keep "active server" unchanged when clicking an
          // off-active row. Terminal + browser-focus get routed at sub.serverId.
          onNavigate(sub);
          await activateSessionCard(sub, serverLabel);
        }}
      >
        {/* Selected-session indicator — accent bar on the left edge */}
        {isSelected && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent-600 dark:bg-accent-400 rounded-l"
          />
        )}
        {/* Unsubscribe button — top-right, appears on hover (watching only) */}
        {onUnsubscribe && subKey && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnsubscribe(subKey);
            }}
            className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-md border border-gray-300 dark:border-gray-500"
            title="Unsubscribe"
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        {/* Project / Session on two lines */}
        <div className="flex-1 min-w-0 pb-1">
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{sub.project.split('/').pop()}</span>
            <ServerIcon
              name={serverIcon}
              size={14}
              className="flex-shrink-0 text-black"
              title={serverLabel ? `Server: ${serverLabel}` : undefined}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{sub.session}</span>
            {(ctxHigh || ctxWarn) && (
              <span className={`flex-shrink-0 text-[10px] font-bold tabular-nums px-1 py-0.5 rounded leading-none ${ctxHigh ? 'bg-red-500 text-white' : 'bg-yellow-400 text-yellow-900'}`}>
                {ctx}%
              </span>
            )}
            {elapsed && (
              <span className="text-[10px] text-black tabular-nums flex-shrink-0 ml-auto">
                {elapsed}
              </span>
            )}
          </div>
        </div>
        {/* Context bar — pinned to bottom of card */}
        {ctx !== undefined && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
            <div
              className={`h-full transition-all ${
                ctxHigh ? 'bg-red-500 animate-pulse' : ctxWarn ? 'bg-yellow-500' : 'bg-green-400/60'
              }`}
              style={{ width: `${Math.min(ctx, 100)}%` }}
            />
          </div>
        )}
      </div>
      {/* Action buttons — outside the card, own bordered section, square columns */}
      <div className="flex items-center flex-shrink-0 gap-1 px-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSupervise(sub, !supervised);
          }}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-all hover:opacity-80 active:scale-90 active:brightness-75 ${supervised ? 'bg-green-300 text-green-900' : 'bg-gray-200 text-gray-500'}`}
          title={supervised ? 'Stop supervising' : 'Supervise this session'}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.661 2.237a.531.531 0 01.678 0 11.947 11.947 0 007.078 2.749.5.5 0 01.479.425c.069.52.104 1.05.104 1.59 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 01-.332 0C5.26 16.564 2 12.163 2 7c0-.538.035-1.069.104-1.589a.5.5 0 01.48-.425 11.947 11.947 0 007.077-2.75zM10 8a2 2 0 100-4 2 2 0 000 4zm0 1.5c-1.66 0-3 1.12-3 2.5v.5h6v-.5c0-1.38-1.34-2.5-3-2.5z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {/* Claude pixel avatar — outside the colored card, right side */}
      <ClaudePixAvatar status={sub.status} />
    </div>
  );
};
