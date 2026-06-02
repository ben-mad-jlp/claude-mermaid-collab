/**
 * OtherSessionsSection — "Option D: lazy per-session expand" for the
 * project-scoped Artifact tree.
 *
 * The main ArtifactTree is inherently single-session-scoped (it renders the
 * artifacts the data-loader pulled for the CURRENT session). This section sits
 * BELOW that tree and lets the user BROWSE artifacts across the *other* sessions
 * of the active project WITHOUT eager fan-out, a new backend endpoint, or any
 * DB: each other-session node is collapsed by default and only fetches its
 * artifacts (reusing the existing per-session `api.get*` list calls) when the
 * user expands it. Results are cached (module-level, keyed by
 * `server::project::session`) so re-expand never refetches.
 *
 * GROUND TRUTH (see research-artifact-data-model): artifact IDs are unique
 * PER SESSION, so every node here is keyed `session:id`, never a bare id.
 * Clicking an artifact under another session switches the current session to it
 * (reusing the same switch action ProjectScopeSection uses) and selects it — a
 * cross-session editor open would be fragile, so we switch-then-select instead.
 */

import React, { useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { useUIStore } from '../../../stores/uiStore';
import { api } from '../../../lib/api';
import type { Session } from '../../../types/session';

type ArtifactKind = 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet';

interface FetchedArtifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  deprecated?: boolean;
}

interface CacheEntry {
  status: 'loading' | 'loaded' | 'error';
  artifacts: FetchedArtifact[];
  error?: string;
}

// Module-level cache survives section collapse/expand and tree remounts so a
// re-expand never refetches. Keyed by `serverId::project::session`.
const sessionArtifactCache = new Map<string, CacheEntry>();

function cacheKey(serverId: string, project: string, session: string): string {
  return `${serverId}::${project}::${session}`;
}

const KIND_GLYPH: Record<ArtifactKind, string> = {
  diagram: '▱',
  document: '▤',
  design: '◈',
  spreadsheet: '▦',
  snippet: '✂',
};

async function fetchSessionArtifacts(
  serverId: string,
  project: string,
  session: string,
): Promise<FetchedArtifact[]> {
  // Reuse the existing per-session list APIs (one session each). Tolerate a
  // per-type fetch failure rather than failing the whole session.
  const settled = await Promise.allSettled([
    api.getDiagrams(serverId, project, session),
    api.getDocuments(serverId, project, session),
    api.getDesigns(serverId, project, session),
    api.getSpreadsheets(serverId, project, session),
    api.getSnippets(serverId, project, session),
  ]);
  const kinds: ArtifactKind[] = ['diagram', 'document', 'design', 'spreadsheet', 'snippet'];
  const out: FetchedArtifact[] = [];
  let anyOk = false;
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      anyOk = true;
      for (const item of res.value as Array<{ id: string; name: string; deprecated?: boolean }>) {
        out.push({ id: item.id, name: item.name, kind: kinds[i], deprecated: item.deprecated });
      }
    }
  });
  if (!anyOk) throw new Error('Failed to load this session’s items');
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const SessionNode: React.FC<{
  session: Session;
  onSelectArtifact: (session: Session, art: FetchedArtifact) => void;
}> = ({ session, onSelectArtifact }) => {
  const key = cacheKey(session.serverId, session.project, session.name);
  const [open, setOpen] = useState(false);
  // Local tick to re-render when the module cache for THIS session updates.
  const [, force] = useState(0);
  const entry = sessionArtifactCache.get(key);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !sessionArtifactCache.has(key)) {
      sessionArtifactCache.set(key, { status: 'loading', artifacts: [] });
      force((n) => n + 1);
      // Race guard: only the most recent fetch for THIS exact key writes the
      // cache. A stale fetch (key already replaced/cleared) is dropped.
      void fetchSessionArtifacts(session.serverId, session.project, session.name)
        .then((artifacts) => {
          sessionArtifactCache.set(key, { status: 'loaded', artifacts });
          force((n) => n + 1);
        })
        .catch((err) => {
          sessionArtifactCache.set(key, {
            status: 'error',
            artifacts: [],
            error: err instanceof Error ? err.message : 'fetch failed',
          });
          force((n) => n + 1);
        });
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        title={session.name}
        className="w-full flex items-center gap-1.5 px-2 py-0.5 text-2xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-left"
      >
        <span className="text-gray-400 dark:text-gray-500 select-none">{open ? '▾' : '▸'}</span>
        <span className="flex-1 truncate">{session.name}</span>
        {entry?.status === 'loaded' && (
          <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500 font-mono">
            {entry.artifacts.length}
          </span>
        )}
        {entry?.status === 'loading' && (
          <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">…</span>
        )}
        {entry?.status === 'error' && (
          <span className="shrink-0 text-3xs text-danger-500" title={entry.error}>⚠</span>
        )}
      </button>
      {open && (
        <div className="ml-3 border-l border-gray-200 dark:border-gray-700">
          {entry?.status === 'loading' && (
            <p className="px-3 py-0.5 text-3xs text-gray-400 dark:text-gray-500">Loading…</p>
          )}
          {entry?.status === 'error' && (
            <p className="px-3 py-0.5 text-3xs text-danger-500" title={entry.error}>
              {entry.error}
            </p>
          )}
          {entry?.status === 'loaded' && entry.artifacts.length === 0 && (
            <p className="px-3 py-0.5 text-3xs text-gray-400 dark:text-gray-500">No items.</p>
          )}
          {entry?.status === 'loaded' &&
            entry.artifacts.map((art) => (
              <button
                // Keyed by session:id — artifact ids are unique only per session.
                key={`${session.name}:${art.kind}:${art.id}`}
                type="button"
                onClick={() => onSelectArtifact(session, art)}
                title={`${art.name} — switch to ${session.name} and open`}
                className={`w-full flex items-center gap-1.5 pl-3 pr-2 py-0.5 text-2xs text-left rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${art.deprecated ? 'text-gray-400 dark:text-gray-600 line-through' : 'text-gray-700 dark:text-gray-300'}`}
              >
                <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500 select-none">
                  {KIND_GLYPH[art.kind]}
                </span>
                <span className="flex-1 truncate">
                  {art.name.includes('/') ? art.name.split('/').pop() : art.name}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

export const OtherSessionsSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const currentSession = useSessionStore((s) => s.currentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const activeProject = useUIStore((s) => s.activeProject);

  // Project in scope: explicit selection → current session's project.
  const project = activeProject ?? currentSession?.project ?? null;

  // The project's OTHER sessions (exclude the one already rendered above).
  const otherSessions = React.useMemo(() => {
    if (!project) return [];
    return sessions
      .filter((s) => s.project === project && s.name !== currentSession?.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions, project, currentSession?.name]);

  // Switch to the artifact's session, then select it once that session's data
  // has loaded. Cross-session editor open is fragile, so we do switch+select:
  // the data-loader populates the new session's store, and the artifact will be
  // present in the main tree where the existing selection/open path handles it.
  const handleSelectArtifact = React.useCallback(
    (session: Session, art: FetchedArtifact) => {
      setCurrentSession(session);
      const store = useSessionStore.getState();
      const select = () => {
        switch (art.kind) {
          case 'diagram':
            store.selectDiagram(art.id);
            break;
          case 'document':
            store.selectDocument(art.id);
            break;
          case 'design':
            store.selectDesign(art.id);
            break;
          case 'spreadsheet':
            store.selectSpreadsheet(art.id);
            break;
          case 'snippet':
            store.selectSnippet(art.id);
            break;
        }
      };
      // Defer one tick so the session-change data load can begin; selection is
      // idempotent if the artifact isn't in the store yet.
      setTimeout(select, 0);
    },
    [setCurrentSession],
  );

  if (!project || otherSessions.length === 0) return null;

  return (
    <div className="px-1 pb-2 border-t border-gray-100 dark:border-gray-800 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
        data-testid="other-sessions-toggle"
      >
        <span className="text-gray-400 dark:text-gray-500 select-none">{open ? '▾' : '▸'}</span>
        Other sessions
        <span className="text-gray-400 dark:text-gray-500 font-normal">{otherSessions.length}</span>
      </button>
      {open && (
        <div className="mt-0.5" data-testid="other-sessions-list">
          {otherSessions.map((s) => (
            <SessionNode key={`${s.project}::${s.name}`} session={s} onSelectArtifact={handleSelectArtifact} />
          ))}
        </div>
      )}
    </div>
  );
};

export default OtherSessionsSection;
