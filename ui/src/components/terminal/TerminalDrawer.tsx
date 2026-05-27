import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { TerminalPane } from './TerminalPane';

/**
 * Bottom drawer hosting the in-app terminal. Rendered as a fixed overlay (not a
 * layout split) to keep App.tsx untouched. The PTY session id is the collab
 * session name; remounts when the session changes (key) so each session gets
 * its own shell.
 */
export function TerminalDrawer() {
  const open = useTerminalStore((s) => s.open);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const currentSession = useSessionStore((s) => s.currentSession);

  if (!open) return null;
  const sessionId = currentSession?.name ?? 'scratch';

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, height: 300, zIndex: 40,
        background: '#0d1117', borderTop: '1px solid #30363d',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 10px', borderBottom: '1px solid #30363d',
          color: '#c9d1d9', fontSize: 12,
        }}
      >
        <span>Terminal — {sessionId}</span>
        <button type="button" onClick={() => setOpen(false)} title="Close terminal" style={{ cursor: 'pointer', color: '#c9d1d9' }}>
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
        <TerminalPane key={sessionId} sessionId={sessionId} />
      </div>
    </div>
  );
}
