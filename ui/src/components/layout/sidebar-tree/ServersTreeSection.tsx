/**
 * ServersTreeSection — sidebar tree section listing known collab servers.
 *
 * Mirrors the affordances of ServerSwitcher (status dot, icon, label,
 * host:port, switch-on-click, manual add/remove) but rendered as a sidebar-
 * tree section above Watching. The header-mounted ServerSwitcher coexists
 * with this section until Wave 2's `header-remove-server-switcher` task
 * removes it; ServerSwitcher.tsx is deleted in Wave 3's cleanup.
 */
import React, { forwardRef, useState, useImperativeHandle } from 'react';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';

const STATUS_DOT: Record<string, string> = {
  online: '#3fb950',
  offline: '#6e7681',
  connecting: '#d29922',
  // Reachable but rejecting the saved token (401) — red, distinct from the grey
  // 'offline' (down) so a fixable auth problem doesn't read as an outage.
  unauthorized: '#f85149',
};

export interface ServersTreeSectionProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export interface ServersTreeSectionHandle {
  revealAddForm: () => void;
}

const ServersTreeSection = forwardRef<ServersTreeSectionHandle, ServersTreeSectionProps>(
  (props, ref) => {
    const { available, servers, addServer, removeServer, pairServer, unpairServer, recheckServer, setServerToken, stopServer } = useServers();

    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const isCollapsed = props.collapsed ?? internalCollapsed;
    const handleToggle = props.onToggle ?? (() => setInternalCollapsed((c) => !c));

    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ label: '', host: '', port: '9002', token: '' });
    const [error, setError] = useState<string | null>(null);

    // Remote-launch dialog state. We start a collab server on a remote box over
    // SSH via the LOCAL sidecar (POST /api/server/launch). The SSH user + start
    // command are remembered per host (non-secret, localStorage); the password
    // is asked each time and never stored.
    const [launchFor, setLaunchFor] = useState<string | null>(null);
    // `token` is the bearer token the detect step wove into the start command;
    // we thread it back on launch so a hand-edited command still comes up
    // auth-required (a 0.0.0.0-bound server must never be open on the LAN).
    const [launchForm, setLaunchForm] = useState({ user: '', password: '', command: '', token: '' });
    const [launching, setLaunching] = useState(false);
    const [launchMsg, setLaunchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const prefillKey = (host: string, port: number) => `mc-launch-prefill:${host}:${port}`;
    const openLaunch = (host: string, port: number, id: string) => {
      setLaunchMsg(null);
      let user = '';
      // Default binds all interfaces so the remote is reachable off-box (the
      // server defaults to localhost otherwise). Editable + remembered per host.
      let command = `MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start --port ${port}`;
      try {
        const saved = JSON.parse(localStorage.getItem(prefillKey(host, port)) || '{}');
        if (saved.user) user = saved.user;
        if (saved.command) command = saved.command;
      } catch { /* ignore */ }
      setLaunchForm({ user, password: '', command, token: '' });
      setLaunchFor(id);
    };

    const [detecting, setDetecting] = useState(false);
    const detectCommand = async (host: string, port: number) => {
      setLaunchMsg(null);
      setDetecting(true);
      try {
        // Reuse the token already baked into the current start command (from a
        // prior launch) rather than minting a fresh one — the server treats its
        // config.json token as authoritative and ignores a new env token, so a
        // freshly-minted token would diverge and every authed call would 401.
        const existingToken = launchForm.command.match(/MERMAID_AUTH_TOKEN=(\S+)/)?.[1] || launchForm.token || undefined;
        const res = await fetch('/api/server/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, port, user: launchForm.user.trim() || undefined, password: launchForm.password || undefined, token: existingToken }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          if (body.suggestedCommand) {
            setLaunchForm((f) => ({ ...f, command: body.suggestedCommand, token: body.token || '' }));
            setLaunchMsg(body.note ? { kind: 'err', text: body.note } : { kind: 'ok', text: 'Detected a start command.' });
          } else {
            setLaunchMsg({ kind: 'err', text: body.note || 'Could not detect a start command — set it manually.' });
          }
        } else {
          setLaunchMsg({ kind: 'err', text: body.error || `Detect failed (${res.status})` });
        }
      } catch (err: any) {
        setLaunchMsg({ kind: 'err', text: err?.message ?? 'Detect failed' });
      } finally {
        setDetecting(false);
      }
    };

    const submitLaunch = async (e: React.FormEvent, host: string, port: number) => {
      e.preventDefault();
      setLaunchMsg(null);
      if (!launchForm.command.trim()) {
        setLaunchMsg({ kind: 'err', text: 'A start command is required' });
        return;
      }
      setLaunching(true);
      try {
        const res = await fetch('/api/server/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            port,
            user: launchForm.user.trim() || undefined,
            password: launchForm.password || undefined,
            command: launchForm.command,
            token: launchForm.token || undefined,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          // The launched server requires this token — persist it onto the
          // connection so the immediate recheck/connect authenticates instead of
          // hitting a 401. Prefer the detect-resolved token; otherwise pull it
          // straight out of the start command so a Launch WITHOUT a prior Detect
          // (e.g. a localStorage-prefilled command after a reboot) still syncs the
          // desktop to the server's token. (No-op outside Electron / no token.)
          const effectiveToken =
            launchForm.token || launchForm.command.match(/MERMAID_AUTH_TOKEN=(\S+)/)?.[1];
          if (effectiveToken) {
            try { await setServerToken(launchFor!, effectiveToken); } catch { /* best-effort */ }
          }
          // Remember the non-secret bits for next time.
          try {
            localStorage.setItem(prefillKey(host, port), JSON.stringify({ user: launchForm.user.trim(), command: launchForm.command }));
          } catch { /* ignore */ }
          setLaunchMsg({ kind: 'ok', text: body.reachable ? 'Server is up.' : 'Launched — waiting for it to come online…' });
          void recheckServer(launchFor!);
          setTimeout(() => { setLaunchFor(null); setLaunchMsg(null); }, 1500);
        } else {
          setLaunchMsg({ kind: 'err', text: body.error || `Launch failed (${res.status})` });
        }
      } catch (err: any) {
        setLaunchMsg({ kind: 'err', text: err?.message ?? 'Launch failed' });
      } finally {
        setLaunching(false);
      }
    };

    useImperativeHandle(ref, () => ({
      revealAddForm: () => setAdding(true),
    }), []);

    const submitAdd = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const port = Number(form.port);
      if (!form.label || !form.host || !Number.isFinite(port)) {
        setError('Label, host, and a numeric port are required');
        return;
      }
      if (!available) {
        setError('Adding servers requires the desktop app');
        return;
      }
      try {
        await addServer({ label: form.label, host: form.host, port, token: form.token || undefined });
        setForm({ label: '', host: '', port: '9002', token: '' });
        setAdding(false);
      } catch (err: any) {
        setError(err?.message ?? 'Failed to add server');
      }
    };

    const handleRemove = async (id: string) => {
      if (!available) return;
      try { await removeServer(id); } catch { /* surface in toast later */ }
    };

    const handlePair = async (id: string) => {
      if (!available) return;
      try { await pairServer(id); } catch { /* surface in toast later */ }
    };

    const handleUnpair = async (id: string) => {
      if (!available) return;
      try { await unpairServer(id); } catch { /* surface in toast later */ }
    };

    const handleStop = async (id: string, host: string, port: number) => {
      if (!available) return;
      if (!window.confirm(`Stop the collab server on ${host}:${port}?\n\nThis shuts down the remote process. The server stays in your list and can be relaunched.`)) return;
      try { await stopServer(id); } catch { /* surface in toast later */ }
    };

    return (
      <div data-testid="sidebar-servers-section" className="border-b border-gray-200 dark:border-gray-700">
        {/* Header — mirrors the Watching panel */}
        <div className="flex items-center">
          <button
            onClick={handleToggle}
            className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Servers</span>
            <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
              {servers.length}
            </span>
            <svg
              className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {/* Add server button */}
          <button
            onClick={() => { if (isCollapsed) handleToggle(); setAdding(true); }}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Add a server"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        {!isCollapsed && (
          <div className="px-2 pb-2 space-y-1">
            {servers.length === 0 && (
              <div className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                No servers found
              </div>
            )}
            {servers.map((s) => {
              const isManual = s.source === 'manual';
              const isPending = s.pairing === 'pending';
              // A paired server gets an Unpair affordance — except the desktop's own
              // local/home server, which is auto-paired; hiding Unpair for source==='local'
              // keeps the user from locking themselves out of their home instance.
              const canUnpair = s.pairing === 'paired' && s.source !== 'local';
              return (
                <div
                  key={s.id}
                  data-testid={`sidebar-server-row-${s.id}`}
                >
                  <div
                    className={`relative group flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300 ${isPending ? 'opacity-60' : ''}`}
                    title={isPending ? `${s.label} (pending — pair to trust)` : s.label}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: STATUS_DOT[s.status] ?? STATUS_DOT.offline,
                        flexShrink: 0,
                      }}
                    />
                    <ServerIcon name={s.icon} size={14} title={`Server: ${s.label}`} />
                    <span className="flex-1 min-w-0 truncate">
                      {s.label || 'server'}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 truncate">
                      {s.host}:{s.port}
                    </span>
                    {isPending && (
                      <span
                        data-testid={`server-pending-badge-${s.id}`}
                        className="shrink-0 px-1 py-px text-[10px] leading-none rounded bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300"
                        title="This server is discovered but not yet trusted"
                      >
                        Pending
                      </span>
                    )}
                    {s.status === 'unauthorized' && (
                      <span
                        data-testid={`server-unauthorized-badge-${s.id}`}
                        className="shrink-0 px-1 py-px text-[10px] leading-none rounded bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300"
                        title="Reachable, but the server rejected the saved token (401). The token is missing, wrong, or could not be decrypted (e.g. after a reboot). Re-enter it in this server's Secrets (Settings gear), then Recheck."
                      >
                        Auth
                      </span>
                    )}
                    {isPending && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handlePair(s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-success-500 dark:hover:text-success-400"
                        title="Pair (trust this server for cross-server calls)"
                        aria-label={`Pair ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                    {canUnpair && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleUnpair(s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-warning-500 dark:hover:text-warning-400"
                        title="Unpair (revoke trust and remove this server)"
                        aria-label={`Unpair ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                    {s.status !== 'online' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openLaunch(s.host, s.port, s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-success-500 dark:hover:text-success-400"
                        title="Launch the collab server on this machine (SSH)"
                        aria-label={`Launch server ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.3 2.84A1 1 0 004.8 3.7v12.6a1 1 0 001.5.86l10.5-6.3a1 1 0 000-1.72L6.3 2.84z" />
                        </svg>
                      </button>
                    )}
                    {/* Stop — only for a reachable, non-home server. The home (source==='local')
                        server is the desktop's own backend; stopping it would kill the app. */}
                    {s.status === 'online' && s.source !== 'local' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleStop(s.id, s.host, s.port); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-danger-500 dark:hover:text-danger-400"
                        title="Stop the collab server on this machine"
                        aria-label={`Stop server ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <rect x="5" y="5" width="10" height="10" rx="1.5" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void recheckServer(s.id); }}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-info-500 dark:hover:text-info-400 ${s.status === 'connecting' ? 'animate-spin opacity-100' : ''}`}
                      title="Recheck availability"
                      aria-label={`Recheck ${s.label}`}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {isManual ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleRemove(s.id); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-danger-500 dark:hover:text-danger-400"
                        title="Remove server"
                        aria-label={`Remove ${s.label}`}
                      >
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  {launchFor === s.id && (
                    <form onSubmit={(e) => submitLaunch(e, s.host, s.port)} className="px-2 py-1.5 mt-1 grid gap-1.5 rounded bg-gray-50 dark:bg-gray-800/60">
                      <div className="text-2xs text-gray-500 dark:text-gray-400">
                        Launch on <span className="font-medium">{s.host}:{s.port}</span> over SSH
                      </div>
                      <input
                        placeholder="SSH user (blank = your default)"
                        value={launchForm.user}
                        onChange={(e) => setLaunchForm({ ...launchForm, user: e.target.value })}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                      />
                      <input
                        placeholder="SSH password (blank = use keys/agent)"
                        type="password"
                        autoComplete="off"
                        value={launchForm.password}
                        onChange={(e) => setLaunchForm({ ...launchForm, password: e.target.value })}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          placeholder="Start command"
                          value={launchForm.command}
                          onChange={(e) => setLaunchForm({ ...launchForm, command: e.target.value })}
                          className="flex-1 min-w-0 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                        />
                        <button
                          type="button"
                          onClick={() => void detectCommand(s.host, s.port)}
                          disabled={detecting}
                          title="SSH in and suggest a start command"
                          className="shrink-0 px-2 py-1 text-2xs text-info-600 dark:text-info-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50"
                        >
                          {detecting ? '…' : 'Detect'}
                        </button>
                      </div>
                      {launchMsg && (
                        <span className={`text-2xs ${launchMsg.kind === 'ok' ? 'text-success-600 dark:text-success-400' : 'text-danger-500 dark:text-danger-400'}`}>
                          {launchMsg.text}
                        </span>
                      )}
                      <div className="flex gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => { setLaunchFor(null); setLaunchMsg(null); }}
                          className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={launching}
                          className="px-2 py-0.5 text-xs bg-success-600 text-white rounded hover:bg-success-700 disabled:opacity-50"
                        >
                          {launching ? 'Launching…' : 'Launch'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}

            {adding && (
              <form onSubmit={submitAdd} className="px-2 py-1.5 grid gap-1.5">
                  <input
                    placeholder="Label"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                  />
                  <input
                    placeholder="Host (e.g. 192.168.1.20)"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                  />
                  <input
                    placeholder="Port"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                  />
                  <input
                    placeholder="Token (optional)"
                    type="password"
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-info-400"
                  />
                  {error && <span className="text-xs text-danger-500 dark:text-danger-400">{error}</span>}
                  <div className="flex gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => { setAdding(false); setError(null); }}
                      className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-xs bg-info-500 text-white rounded hover:bg-info-600"
                    >
                      Save &amp; Connect
                    </button>
                  </div>
              </form>
            )}
          </div>
        )}
      </div>
    );
  },
);

ServersTreeSection.displayName = 'ServersTreeSection';

export { ServersTreeSection };
export default ServersTreeSection;
