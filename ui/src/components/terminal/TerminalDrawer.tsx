import { useEffect } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServer } from '@/contexts/ServerContext';
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
  const { servers, activeId } = useServer();

  const openForActive = () => {
    if (!currentSession) return;
    if (!activeId) {
      console.warn('[TerminalDrawer] no active server — cannot open terminal');
      return;
    }
    const label = servers.find((s) => s.id === activeId)?.label;
    void openFor(currentSession.project, currentSession.name, { serverId: activeId, serverLabel: label });
  };

  // Auto-open a tab for the current session when the column first opens with no tabs
  useEffect(() => {
    if (open && tabs.length === 0 && currentSession && activeId) {
      const label = servers.find((s) => s.id === activeId)?.label;
      void openFor(currentSession.project, currentSession.name, { serverId: activeId, serverLabel: label });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* New tab button */}
        <button
          type="button"
          onClick={() => openForActive()}
          title="New terminal"
          style={{
            cursor: 'pointer', color: '#6e7681', background: 'none',
            border: 'none', padding: '4px 8px', fontSize: 16, lineHeight: 1,
          }}
        >
          +
        </button>

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
