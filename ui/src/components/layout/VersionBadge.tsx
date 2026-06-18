import React, { useEffect, useState } from 'react';

/**
 * Tiny always-visible badge showing the DEPLOYED server version, pinned at the
 * bottom of the sidebar. Sources `/api/health` (.version === the sidecar's
 * SERVER_VERSION) — the same value deploy-status calls `liveVersion`, so what
 * you read here is exactly what's running on :9002. Renders nothing until the
 * version resolves (and stays hidden if health is unreachable).
 */
export const VersionBadge: React.FC = () => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.version === 'string') setVersion(d.version);
      })
      .catch(() => {
        /* health unreachable — leave the badge hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!version) return null;

  return (
    <div
      className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-1 text-[10px] text-right text-gray-400 dark:text-gray-500 select-all tabular-nums"
      title="Deployed server version (running on :9002)"
    >
      v{version}
    </div>
  );
};

export default VersionBadge;
