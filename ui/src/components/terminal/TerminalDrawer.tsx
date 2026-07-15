import { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { useNotificationStore } from '@/stores/notificationStore';
import { ResizableColumn } from '@/components/layout/ResizableColumn';
import { TerminalConsole } from './TerminalPane';
import { GrokTranscript } from './GrokTranscript';
import { InputRail } from './InputRail';
import { MessageComposer } from './MessageComposer';
import { TerminalThemePicker } from './TerminalThemePicker';
import { useTerminalPalette } from './terminalTheme';
import { routeComposerDrop } from './composerDrop';
import { ServerIcon } from '@/components/ServerIcon';

/**
 * Right-side resizable column hosting the in-app terminal. A SINGLE persistent
 * console (one WS per server) is re-pointed to the active (serverId, session)
 * tmux target on switch — replacing the old tab strip that mounted one xterm +
 * PTY per opened session. The session switcher that drives which target is shown
 * lands in a later leaf; this drawer keeps the server picker + controls.
 */
export function TerminalDrawer({ embedded = false }: { embedded?: boolean } = {}) {
  const open = useTerminalStore((s) => s.open);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const width = useTerminalStore((s) => s.width);
  const setWidth = useTerminalStore((s) => s.setWidth);
  const { servers } = useServers();
  const p = useTerminalPalette();

  // Whole-terminal file-drop zone → routes into the message composer. Native
  // listeners (OS file drops don't reliably fire React synthetic drag events in a
  // sandboxed Electron renderer). A drag carrying files/URIs anywhere over the
  // terminal body highlights + drops into the composer.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types || []).some((t) => t === 'Files' || t === 'text/uri-list');
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setDropActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      setDropActive(false);
      routeComposerDrop(e.dataTransfer);
    };
    // Capture phase so we intercept before xterm's canvas can swallow the drop.
    // dragenter preventDefault too — some Chromium builds won't fire `drop`
    // without it. Capture phase so we beat xterm's canvas.
    el.addEventListener('dragenter', onDragOver, true);
    el.addEventListener('dragover', onDragOver, true);
    el.addEventListener('dragleave', onDragLeave, true);
    el.addEventListener('drop', onDrop, true);
    return () => {
      el.removeEventListener('dragenter', onDragOver, true);
      el.removeEventListener('dragover', onDragOver, true);
      el.removeEventListener('dragleave', onDragLeave, true);
      el.removeEventListener('drop', onDrop, true);
    };
  }, []);

  // The single console's target: the active registered session (its tmux base +
  // server). The console re-points to this; selecting another session updates it.
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // DORMANT branch probe: the active lane's provider. Default 'claude' so the
  // tmux console + send-keys path is byte-identical until the read-only
  // /api/worker-transcript endpoint reports an in-process grok-build lane. A
  // Claude lane (no grok lane) returns { provider: null } → stays 'claude'. This
  // never engages unless a todo was pinned to provider 'grok-build'.
  const [laneProvider, setLaneProvider] = useState<'claude' | 'grok-build'>('claude');
  useEffect(() => {
    setLaneProvider('claude');
    if (!activeTab) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async () => {
      const path = `/api/worker-transcript?project=${encodeURIComponent(activeTab.project)}&session=${encodeURIComponent(activeTab.session)}`;
      const mc = (window as any).mc;
      try {
        const data = mc?.invokeOnServer
          ? await mc.invokeOnServer(activeTab.serverId, { path, method: 'GET' })
          : typeof fetch !== 'undefined'
            ? await (await fetch(path)).json()
            : null;
        if (!cancelled) setLaneProvider(data?.provider === 'grok-build' ? 'grok-build' : 'claude');
      } catch {
        if (!cancelled) setLaneProvider('claude');
      }
      if (!cancelled) timer = setTimeout(probe, 2000);
    };
    void probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab]);
  const isGrokLane = laneProvider === 'grok-build';

  // consoleEpoch (terminalStore) keys the persistent console; bumping it remounts
  // the xterm + WebSocket → a clean tmux attach-redraw. This is the client-side
  // cure for the "blank console + blinking cursor" state (xterm attached + WS
  // connected, but the one-shot redraw never painted). reattachConsole() is the
  // shared trigger any refresh path can call; the server /reset can't repaint a
  // blanked client xterm.
  const consoleEpoch = useTerminalStore((s) => s.consoleEpoch);
  const reattachConsole = useTerminalStore((s) => s.reattachConsole);

  // No auto-open: clicking a watched row is the explicit entry point for a
  // terminal. Auto-open would race with the watched-row open and steal focus by
  // creating a session on the active server immediately after the user opened one
  // on a different server.

  const resetActiveTerminal = () => {
    const tab = activeTab;
    if (!tab) return;
    // Client-side cure first: remount the xterm/WS so a blanked console repaints
    // even if the server is fine. Runs alongside the server-side TUI re-sync below.
    reattachConsole();
    const reqPath = `/api/terminal/sessions/${encodeURIComponent(tab.id)}/reset?project=${encodeURIComponent(tab.project)}&session=${encodeURIComponent(tab.session)}`;
    const onOk = () => {
      useNotificationStore.getState().addToast({
        type: 'success', title: 'Terminal reset',
        message: 'Re-synced Claude TUI (/tui fullscreen).', duration: 3000,
      });
    };
    const mc = (window as any).mc;
    if (mc?.invokeOnServer) {
      void mc.invokeOnServer(tab.serverId, { path: reqPath, method: 'POST' })
        .then((res: { ok: boolean }) => { if (res?.ok) onOk(); })
        .catch(() => { /* ignore */ });
    } else if (typeof fetch !== 'undefined') {
      void fetch(reqPath, { method: 'POST' })
        .then((res) => { if (res.ok) onOk(); })
        .catch(() => { /* ignore */ });
    }
  };

  const openExternalTerminal = async () => {
    const tab = activeTab;
    if (!tab) return;
    const mc = (window as any).mc;
    if (!mc?.openExternalTerminal) {
      useNotificationStore.getState().addToast({
        type: 'info', title: 'External terminal unavailable',
        message: 'Only available in the desktop app.', duration: 3000,
      });
      return;
    }
    const result = await mc.openExternalTerminal(tab.tmuxName);
    if (result?.ok === false) {
      useNotificationStore.getState().addToast({
        type: 'error', title: 'Failed to open external terminal',
        message: result.error ?? 'Unknown error', duration: 4000,
      });
    }
  };

  const externalTerminalAvailable =
    typeof window !== 'undefined' && Boolean((window as any).mc?.openExternalTerminal);

  if (!open) return null;

  const inner = (
      <div
        ref={bodyRef}
        style={{
          position: 'relative',
          background: '#0d1117', display: 'flex', flexDirection: 'column', flex: 1,
          minHeight: 0, height: embedded ? '100%' : undefined,
          outline: dropActive ? `2px dashed ${p.accent}` : 'none', outlineOffset: -2,
        }}
      >
      {dropActive && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,17,23,0.55)', color: p.fg, fontSize: 14, fontWeight: 600,
        }}>
          Drop file → composer
        </div>
      )}
      {/* Tab strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 6px', borderBottom: '1px solid #30363d',
          background: '#161b22', minHeight: 32, overflowX: 'auto',
        }}
      >
        {/* Active session label — the single console shows one target at a time.
            The session switcher that re-points it lands in a later leaf. */}
        {activeTab && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', fontSize: 12, color: '#c9d1d9', whiteSpace: 'nowrap',
            }}
          >
            <span>{activeTab.title}</span>
            {!activeTab.hideServerIcon && (() => {
              // Resolve the 'local' SENTINEL to the real local server, same as the
              // supervised cards (c880934): worker tabs carry serverId='local',
              // which never matches the real-UUID-keyed servers list.
              const srv =
                servers.find((s) => s.id === activeTab.serverId) ??
                ((!activeTab.serverId || activeTab.serverId === 'local')
                  ? (servers.find((s) => s.source === 'local') ??
                     servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost'))
                  : undefined);
              const label = activeTab.serverLabel || srv?.label || '(unknown)';
              return <ServerIcon name={srv?.icon} size={14} title={`server: ${label}`} />;
            })()}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Reset terminal */}
        <button
          type="button"
          onClick={resetActiveTerminal}
          title="Reset terminal — reattach the console (fixes a blank pane) + re-sync Claude TUI"
          style={{
            cursor: 'pointer', color: '#6e7681', background: 'none',
            border: 'none', padding: '4px 8px', fontSize: 12,
          }}
        >
          ↺
        </button>

        {/* Open in external terminal (desktop only) */}
        {externalTerminalAvailable && (
          <button
            type="button"
            onClick={() => void openExternalTerminal()}
            title="Open in external terminal"
            style={{
              cursor: 'pointer', color: '#6e7681', background: 'none',
              border: 'none', padding: '4px 8px', fontSize: 12,
            }}
          >
            ⧉
          </button>
        )}

        {/* Terminal theme picker (Match collab / Light / Dark / Sepia). */}
        <TerminalThemePicker palette={p} />
      </div>

      {/* Body — the single persistent console (no left switcher rail, per user).
          Sessions are selected from the watched rows / + button, which call
          openFor and set the active tab; the console re-points to that target
          (no per-session xterm/WS teardown). One WS per server; changing servers
          reconnects through that server's per-server proxy. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
          {!activeTab ? (
            <div style={{ color: '#6e7681', fontSize: 12, padding: 8 }}>
              No terminal open — select a session to attach its console.
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0, padding: 6 }}>
              {isGrokLane ? (
                // grok-build lane: no tmux pane — render the live in-process loop
                // transcript instead of the xterm console.
                <GrokTranscript
                  project={activeTab.project}
                  session={activeTab.session}
                  serverId={activeTab.serverId}
                />
              ) : (
                <TerminalConsole
                  key={consoleEpoch}
                  serverId={activeTab.serverId}
                  tmuxBase={activeTab.tmuxName}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Multi-line composer — a real auto-growing textbox directly below the console,
          for typing an actual message into the live REPL. Send button + a persisted
          "Enter sends" toggle. */}
      <MessageComposer
        project={activeTab?.project ?? ''}
        session={activeTab?.session ?? ''}
        serverId={activeTab?.serverId ?? ''}
        disabled={!activeTab}
        injectMode={isGrokLane}
      />

      {/* Quick-reply chip bar (canned responses) — welded to the very bottom, under the
          composer. Reads the one attached session; greys out when no console attached. */}
      <InputRail
        project={activeTab?.project ?? ''}
        session={activeTab?.session ?? ''}
        serverId={activeTab?.serverId ?? ''}
        disabled={!activeTab || isGrokLane}
      />
      </div>
  );

  // Embedded in the workspace PanelGroup → fill the host Panel; the PanelGroup
  // owns sizing. Standalone → legacy right-docked resizable column.
  if (embedded) return inner;
  return (
    <ResizableColumn width={width} onResize={setWidth} min={320}>
      {inner}
    </ResizableColumn>
  );
}
