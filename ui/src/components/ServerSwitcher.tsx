/**
 * Server switcher (Level 1) — native-app only. Shows the active server, lists
 * known servers (local auto-listed + manually added), switches between them,
 * and adds/removes manual servers. Renders nothing in a plain browser tab
 * (no window.mc). Live health probing of remote servers is a follow-up (it
 * needs an mc.probeServer IPC, since the renderer can't reach other origins).
 */
import React, { useState } from 'react';
import { useServer } from '@/contexts/ServerContext';

const dot: Record<string, string> = {
  online: '#3fb950',
  offline: '#6e7681',
  connecting: '#d29922',
};

export function ServerSwitcher() {
  const { available, servers, activeId, switchServer, addServer, removeServer } = useServer();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '9002', token: '' });

  if (!available) return null;

  const active = servers.find((s) => s.id === activeId);
  const activeLabel = active?.label ?? 'This Mac';

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const port = Number(form.port);
    if (!form.label || !form.host || !Number.isFinite(port)) return;
    await addServer({ label: form.label, host: form.host, port, token: form.token || undefined });
    setForm({ label: '', host: '', port: '9002', token: '' });
    setAdding(false);
  };

  return (
    <div className="server-switcher" style={{ position: 'relative', fontSize: 13 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Switch collab server"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot[active?.status ?? 'online'] }} />
        {activeLabel}
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 shadow-lg"
          style={{ position: 'absolute', top: '100%', left: 0, minWidth: 260, marginTop: 4, borderRadius: 8, zIndex: 50, padding: 6 }}
        >
          {servers.length === 0 && <div style={{ padding: 8, opacity: 0.7 }}>No servers found</div>}
          {servers.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot[s.status] }} />
              <button
                type="button"
                onClick={() => { void switchServer(s.id); setOpen(false); }}
                style={{ flex: 1, textAlign: 'left', cursor: 'pointer', fontWeight: s.id === activeId ? 600 : 400 }}
              >
                {s.label}
                <span style={{ opacity: 0.6, marginLeft: 6 }}>{s.host}:{s.port}</span>
                {s.id === activeId && <span style={{ marginLeft: 6 }}>✓</span>}
              </button>
              {s.source === 'manual' && (
                <button type="button" title="Remove" onClick={() => void removeServer(s.id)} style={{ cursor: 'pointer', opacity: 0.6 }}>
                  ✕
                </button>
              )}
            </div>
          ))}

          <div className="border-t border-gray-200 dark:border-gray-700" style={{ marginTop: 4, paddingTop: 4 }}>
            {!adding ? (
              <button type="button" onClick={() => setAdding(true)} style={{ padding: '6px 8px', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                + Add server…
              </button>
            ) : (
              <form onSubmit={submitAdd} style={{ display: 'grid', gap: 6, padding: 8 }}>
                <input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                <input placeholder="Host (e.g. 192.168.1.20)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                <input placeholder="Port" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                <input placeholder="Token (optional)" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setAdding(false)}>Cancel</button>
                  <button type="submit">Save &amp; Connect</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
