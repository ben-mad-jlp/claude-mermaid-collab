import React, { useMemo } from 'react';
import { useSessionList } from '../../hooks/useSessionList';
import type { SessionMetadata } from '../../types/agent';

// TODO: upgrade to react-window virtualization when session counts grow large.

export interface SessionPickerProps {
  currentProjectRoot?: string;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRename?: (sessionId: string, currentName?: string) => void;
  onArchive?: (sessionId: string) => void;
}

export function SessionPicker({ currentProjectRoot, activeSessionId, onSelect, onRename, onArchive }: SessionPickerProps) {
  const { sessions, loading, error, refetch } = useSessionList(currentProjectRoot);

  const groups = useMemo(() => {
    // Single "All Sessions" group — grouping by project path can be added when SessionMetadata carries projectRoot.
    const sorted = [...sessions].sort((a, b) => (b.lastActivityTs ?? 0) - (a.lastActivityTs ?? 0));
    return [{ label: 'Sessions', items: sorted }];
  }, [sessions]);

  // Disambiguate unnamed sessions by appending short sessionId when there are multiple.
  const labelFor = (s: SessionMetadata, siblings: SessionMetadata[]): string => {
    if (s.displayName) return s.displayName;
    const unnamedCount = siblings.filter((x) => !x.displayName).length;
    const short = s.sessionId.slice(0, 8);
    return unnamedCount > 1 ? `Session (${short})` : 'Unnamed session';
  };

  if (loading && sessions.length === 0) {
    return (
      <div data-testid="session-picker" className="space-y-1 p-2">
        {[0,1,2].map((i) => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="session-picker" className="p-2 text-xs">
        <div className="text-red-500 mb-2">{error.message}</div>
        <button type="button" onClick={() => refetch()} className="underline">Retry</button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div data-testid="session-picker" className="p-4 text-sm text-muted-foreground">No sessions yet.</div>;
  }

  return (
    <div data-testid="session-picker" className="flex flex-col gap-2 p-1">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{g.label}</h3>
          <ul className="flex flex-col">
            {g.items.map((s) => {
              const isActive = s.sessionId === activeSessionId;
              return (
                <li
                  key={s.sessionId}
                  className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer text-sm hover:bg-accent ${isActive ? 'bg-accent' : ''}`}
                  onClick={() => onSelect(s.sessionId)}
                  data-testid="session-picker-row"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{labelFor(s, g.items)}</div>
                    {s.model && <div className="text-[10px] text-muted-foreground truncate">{s.model}</div>}
                  </div>
                  <KebabMenu sessionId={s.sessionId} displayName={s.displayName} onRename={onRename} onArchive={onArchive} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function KebabMenu({ sessionId, displayName, onRename, onArchive }: {
  sessionId: string; displayName?: string;
  onRename?: (id: string, name?: string) => void;
  onArchive?: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="px-1 text-muted-foreground hover:text-foreground" aria-label="Session options" onClick={() => setOpen((v) => !v)}>⋮</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 rounded-md border bg-popover shadow-md z-50">
          {onRename && <button type="button" onClick={() => { setOpen(false); onRename(sessionId, displayName); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent">Rename</button>}
          {onArchive && <button type="button" onClick={() => { setOpen(false); onArchive(sessionId); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-accent">Archive</button>}
        </div>
      )}
    </div>
  );
}

export default SessionPicker;
