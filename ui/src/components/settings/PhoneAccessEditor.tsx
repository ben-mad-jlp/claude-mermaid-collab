import { useCallback, useEffect, useState } from 'react';

/** Shape of GET /api/pair / POST /api/pair/rotate (src/routes/pair-routes.ts). */
interface HostCandidate {
  address: string;
  iface: string;
  likelyTailscale: boolean;
}
interface PairPayload {
  token: string;
  port: number;
  bound: string;
  hosts: HostCandidate[];
  qr: string | null;
  warning?: string;
}

/**
 * "Phone access" — surface the bearer token + reachable host so the native iOS
 * Zen app can pair over Tailscale. GET /api/pair auto-provisions a token on first
 * open (loopback-only route). Rotate invalidates the old one (a paired phone
 * 401s on its next call → re-pair).
 *
 * The iOS app's primary path is manual host+token entry, so we surface both as
 * copyable fields plus the mermaidcollab:// deep link. (A scannable QR image
 * needs a renderer dependency — tracked as a follow-up.)
 */
export function PhoneAccessEditor() {
  const [data, setData] = useState<PairPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (method: 'GET' | 'ROTATE') => {
    setLoading(true);
    setError(null);
    try {
      const res = method === 'ROTATE'
        ? await fetch('/api/pair/rotate', { method: 'POST' })
        : await fetch('/api/pair');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load('GET'); }, [load]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(c => (c === label ? null : c)), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const best = data?.hosts[0];
  const deepLink = data?.qr ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Phone access</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Pair the native Zen iOS app over Tailscale. Enter the host + token below in the app
          (Settings → Pair), or open the deep link on the phone.
        </p>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400">Couldn’t load pairing info: {error}</div>
      )}

      {data && (
        <>
          {data.warning && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {data.warning}
            </div>
          )}

          <Field
            label="Host"
            value={best ? `${best.address}:${data.port}` : `(no reachable interface) :${data.port}`}
            hint={best?.likelyTailscale ? 'likely Tailscale' : best?.iface}
            onCopy={best ? () => copy('host', `${best.address}:${data.port}`) : undefined}
            copied={copied === 'host'}
          />

          {data.hosts.length > 1 && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Other interfaces:{' '}
              {data.hosts.slice(1).map(h => `${h.address}${h.likelyTailscale ? ' (tailscale?)' : ''}`).join(', ')}
            </div>
          )}

          <Field
            label="Token"
            value={data.token}
            mono
            onCopy={() => copy('token', data.token)}
            copied={copied === 'token'}
          />

          {deepLink && (
            <Field
              label="Deep link"
              value={deepLink}
              mono
              onCopy={() => copy('link', deepLink)}
              copied={copied === 'link'}
            />
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => load('ROTATE')}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              Rotate token
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Rotating signs out any paired phone (it re-pairs on next use).
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label, value, hint, mono, onCopy, copied,
}: {
  label: string; value: string; hint?: string; mono?: boolean; onCopy?: () => void; copied?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}{hint ? <span className="ml-2 font-normal normal-case text-gray-400">· {hint}</span> : null}
        </label>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className={`mt-1 px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

export default PhoneAccessEditor;
