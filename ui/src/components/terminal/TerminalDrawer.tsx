import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { ResizableColumn } from '@/components/layout/ResizableColumn';
import { TerminalPane } from './TerminalPane';
import { ServerIcon } from '@/components/ServerIcon';

/**
 * Right-side resizable column hosting tabbed in-app terminals. Each tab connects
 * to a distinct PTY session (UUID). The tab strip sits above the active pane.
 */
export function TerminalDrawer() {
  const open = useTerminalStore((s) => s.open);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const width = useTerminalStore((s) => s.width);
  const setWidth = useTerminalStore((s) => s.setWidth);
  const setActive = useTerminalStore((s) => s.setActive);
  const closeTab = useTerminalStore((s) => s.closeTab);
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

  if (!open) return null;

  return (
    <ResizableColumn width={width} onResize={setWidth} min={320}>
      <div style={{ background: '#0d1117', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Tab strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 6px', borderBottom: '1px solid #30363d',
          background: '#161b22', minHeight: 32, overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const srv = servers.find((s) => s.id === tab.serverId);
          const label = tab.serverLabel || srv?.label || '(unknown)';
          const icon = srv?.icon;
          return (
          <div
            key={tab.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', cursor: 'pointer', fontSize: 12,
              borderBottom: tab.id === activeTabId ? '2px solid #58a6ff' : '2px solid transparent',
              color: tab.id === activeTabId ? '#c9d1d9' : '#6e7681',
              whiteSpace: 'nowrap',
            }}
            onClick={() => setActive(tab.id)}
          >
            <span>{tab.title}</span>
            <ServerIcon name={icon} size={14} title={`server: ${label}`} />
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

      {/* Active pane */}
      <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
        {activeTabId && tabs.find((t) => t.id === activeTabId) ? (
          (() => {
            const tab = tabs.find((t) => t.id === activeTabId)!;
            return <TerminalPane key={tab.id} sessionId={tab.id} serverId={tab.serverId} />;
          })()
        ) : (
          <div style={{ color: '#6e7681', fontSize: 12, padding: 8 }}>
            No terminal open — click + to start one
          </div>
        )}
      </div>
      </div>
    </ResizableColumn>
  );
}
