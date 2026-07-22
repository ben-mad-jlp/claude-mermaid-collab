import { useEffect, useRef, useState } from 'react';
import { useTerminalPalette } from './terminalTheme';

/**
 * GrokTranscript — the in-app console view for an in-process `grok-build` worker
 * lane. There is no tmux pane to attach an xterm to; the Grok worker is a Vercel
 * AI SDK agentic loop running in the server process. This component polls the
 * read-only `/api/worker-transcript` endpoint (~1s while mounted) and renders the
 * captured agentic steps as a scrolling, auto-following log — the model text, then
 * each tool call as `▸ tool(args)` and its trimmed result.
 *
 * Mounted by LaneCallout when the active lane's provider resolves to
 * 'grok-build'.
 */

export type GrokTranscriptEntry = {
  step: number;
  ts: number;
  text?: string;
  toolCalls?: { name: string; args: unknown }[];
  toolResults?: { name: string; result: string }[];
};

interface GrokTranscriptProps {
  project: string;
  session: string;
  serverId: string;
}

/** Fetch the transcript via the desktop per-server bridge when present, else fetch. */
async function fetchTranscript(
  serverId: string,
  project: string,
  session: string,
): Promise<{ provider: string | null; entries: GrokTranscriptEntry[]; alive?: boolean; phase?: string } | null> {
  const path = `/api/worker-transcript?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
  const mc = (window as any).mc;
  try {
    if (mc?.invokeOnServer) {
      return (await mc.invokeOnServer(serverId, { path, method: 'GET' })) as any;
    }
    if (typeof fetch !== 'undefined') {
      const res = await fetch(path);
      if (!res.ok) return null;
      return (await res.json()) as any;
    }
  } catch {
    /* best-effort poll */
  }
  return null;
}

function argsPreview(args: unknown): string {
  try {
    const s = typeof args === 'string' ? args : JSON.stringify(args);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(args);
  }
}

export function GrokTranscript({ project, session, serverId }: GrokTranscriptProps) {
  const p = useTerminalPalette();
  const [entries, setEntries] = useState<GrokTranscriptEntry[]>([]);
  const [alive, setAlive] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const data = await fetchTranscript(serverId, project, session);
      if (!cancelled && data) {
        setEntries(data.entries ?? []);
        setAlive(data.alive ?? false);
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [project, session, serverId]);

  // Auto-scroll to bottom when new steps arrive, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: '10px 12px',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: p.fg,
        background: p.surface ?? '#0d1117',
      }}
    >
      <div style={{ color: p.mutedFg, marginBottom: 8 }}>
        grok-build worker · live transcript {alive ? '· running' : '· ended'}
      </div>
      {entries.length === 0 ? (
        <div style={{ color: p.mutedFg }}>Waiting for the Grok loop to start…</div>
      ) : (
        entries.map((e) => (
          <div key={`${e.step}-${e.ts}`} style={{ marginBottom: 10 }}>
            <div style={{ color: p.mutedFg, fontSize: 11 }}>step {e.step}</div>
            {e.text && <div style={{ whiteSpace: 'pre-wrap', margin: '2px 0' }}>{e.text}</div>}
            {(e.toolCalls ?? []).map((c, i) => (
              <div key={`c-${i}`} style={{ whiteSpace: 'pre-wrap', color: p.accent }}>
                ▸ {c.name}({argsPreview(c.args)})
              </div>
            ))}
            {(e.toolResults ?? []).map((r, i) => (
              <div key={`r-${i}`} style={{ whiteSpace: 'pre-wrap', color: p.mutedFg, paddingLeft: 14 }}>
                {r.result}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

export default GrokTranscript;
