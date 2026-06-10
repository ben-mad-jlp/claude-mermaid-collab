import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { useNotificationStore } from '@/stores/notificationStore';
import { ResizableColumn } from '@/components/layout/ResizableColumn';
import { TerminalPane } from './TerminalPane';
import { ServerIcon } from '@/components/ServerIcon';

/**
 * Right-side resizable column hosting tabbed in-app terminals. Each tab connects
 * to a distinct PTY session (UUID). The tab strip sits above the active pane.
 */
export function TerminalDrawer({ embedded = false }: { embedded?: boolean } = {}) {
  const open = useTerminalStore((s) => s.open);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const width = useTerminalStore((s) => s.width);
  const setWidth = useTerminalStore((s) => s.setWidth);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const moveTab = useTerminalStore((s) => s.moveTab);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const openFor = useTerminalStore((s) => s.openFor);
  const close = useTerminalStore((s) => s.close);
  const currentSession = useSessionStore((s) => s.currentSession);
  const { servers } = useServers();

  const [menuOpen, setMenuOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const menuServers = useMemo(() => {
    const online = servers.filter((s) => s.status === 'online');
    return online.length > 0 ? online : servers;
  }, [servers]);

  const defaultIdx = useMemo(() => {
    const preferred = currentSession?.serverId;
    if (preferred) {
      const i = menuServers.findIndex((s) => s.id === preferred);
      if (i >= 0) return i;
    }
    const local = menuServers.findIndex((s) => s.id === 'local');
    if (local >= 0) return local;
    return 0;
  }, [menuServers, currentSession?.serverId]);

  useEffect(() => {
    if (!menuOpen) return;
    setFocusedIdx(defaultIdx);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, defaultIdx]);

  const selectServer = (s: typeof menuServers[number]) => {
    if (currentSession) {
      void openFor(currentSession.project, currentSession.name, { serverId: s.id, serverLabel: s.label });
    }
    setMenuOpen(false);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => (i + 1) % menuServers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => (i - 1 + menuServers.length) % menuServers.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = menuServers[focusedIdx];
      if (s) selectServer(s);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
    }
  };

  // No auto-open: clicking a watched row or pressing the + button are the
  // explicit entry points for a new terminal tab. Auto-open would race with
  // the watched-row open and steal focus by creating a tab on the active
  // server immediately after the user opened one on a different server.

  const resetActiveTerminal = () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const reqPath = `/api/terminal/sessions/${encodeURIComponent(tab.id)}/reset?project=${encodeURIComponent(tab.project)}&session=${encodeURIComponent(tab.session)}`;
    const onOk = () => {
      useNotificationStore.getState().addToast({
        type: 'success', title: 'Terminal reset',
        message: 'Re-asserted mouse/scroll modes.', duration: 3000,
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
    const tab = tabs.find((t) => t.id === activeTabId);
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
      <div style={{ background: '#0d1117', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: embedded ? '100%' : undefined }}>
      {/* Tab strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 6px', borderBottom: '1px solid #30363d',
          background: '#161b22', minHeight: 32, overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => {
          // Resolve the 'local' SENTINEL to the real local server, same as the
          // supervised cards (c880934). Worker tabs carry serverId='local', which
          // never matches the real-UUID-keyed servers list → srv was undefined →
          // generic/alien icon. localServerOf aliases it to the actual local server.
          const srv =
            servers.find((s) => s.id === tab.serverId) ??
            ((!tab.serverId || tab.serverId === 'local')
              ? (servers.find((s) => s.source === 'local') ??
                 servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost'))
              : undefined);
          const label = tab.serverLabel || srv?.label || '(unknown)';
          const icon = srv?.icon;
          return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => { setDragTabId(tab.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverTabId !== tab.id) setDragOverTabId(tab.id); }}
            onDrop={(e) => { e.preventDefault(); if (dragTabId) moveTab(dragTabId, tab.id); setDragTabId(null); setDragOverTabId(null); }}
            onDragEnd={() => { setDragTabId(null); setDragOverTabId(null); }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); closeTab(tab.id); } }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', cursor: 'pointer', fontSize: 12,
              borderBottom: tab.id === activeTabId ? '2px solid #58a6ff' : '2px solid transparent',
              borderLeft: dragOverTabId === tab.id && dragTabId !== tab.id ? '2px solid #58a6ff' : '2px solid transparent',
              opacity: dragTabId === tab.id ? 0.5 : 1,
              color: tab.id === activeTabId ? '#c9d1d9' : '#6e7681',
              whiteSpace: 'nowrap',
            }}
            onClick={() => setActive(tab.id)}
          >
            <span>{tab.title}</span>
            {!tab.hideServerIcon && <ServerIcon name={icon} size={14} title={`server: ${label}`} />}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              title="Close tab"
              style={{
                cursor: 'pointer', color: '#6e7681', background: 'none',
                border: 'none', padding: '0 2px', fontSize: 11, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          );
        })}

        {/* New tab dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="New terminal"
            style={{
              cursor: 'pointer', color: '#6e7681', background: 'none',
              border: 'none', padding: '4px 8px', fontSize: 14, lineHeight: 1,
              display: 'inline-flex', alignItems: 'center', gap: 2,
            }}
          >
            <span style={{ fontSize: 16 }}>+</span>
            <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {menuOpen && (
            <div
              ref={(el) => {
                menuRef.current = el;
                if (el) el.focus();
              }}
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              role="menu"
              style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 1000,
                marginTop: 2, minWidth: 160,
                background: '#161b22', border: '1px solid #30363d',
                borderRadius: 4, padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                outline: 'none',
              }}
            >
              {menuServers.map((s, i) => (
                <div
                  key={s.id}
                  role="menuitem"
                  onMouseEnter={() => setFocusedIdx(i)}
                  onClick={() => selectServer(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px', cursor: 'pointer', fontSize: 12,
                    color: '#c9d1d9',
                    background: i === focusedIdx ? '#30363d' : 'transparent',
                    borderLeft: i === focusedIdx ? '2px solid #58a6ff' : '2px solid transparent',
                    borderRadius: 2,
                  }}
                >
                  <ServerIcon name={s.icon} size={14} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Reset terminal */}
        <button
          type="button"
          onClick={resetActiveTerminal}
          title="Reset terminal (unstick mouse/scroll)"
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

        {/* Close drawer */}
        <button
          type="button"
          onClick={close}
          title="Close terminal"
          style={{
            cursor: 'pointer', color: '#6e7681', background: 'none',
            border: 'none', padding: '4px 8px', fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>

      {/* Panes — keep ALL tabs mounted and stacked; only toggle visibility.
          Unmounting on tab switch tore down the xterm + WebSocket and forced the
          server to replay a full-screen TUI's raw buffer at the wrong size
          (jumbled / stale dimensions). With keep-alive, switching is instant,
          the terminal keeps its rendered screen, and inactive panes retain their
          layout size (visibility:hidden ≠ display:none) so they stay correctly
          sized and resize in sync with the pane. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.length === 0 && (
          <div style={{ color: '#6e7681', fontSize: 12, padding: 8 }}>
            No terminal open — click + to start one
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              padding: 6,
              visibility: tab.id === activeTabId ? 'visible' : 'hidden',
              zIndex: tab.id === activeTabId ? 1 : 0,
            }}
          >
            <TerminalPane sessionId={tab.id} serverId={tab.serverId} />
          </div>
        ))}
      </div>
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
