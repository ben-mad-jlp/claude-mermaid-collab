/**
 * ConductorActivityPanel — read-only conductor-pass journal surface for the Bridge.
 * Fetches one PAGE at a time (server-side limit/offset), renders each pass's one-line
 * sentence plus the node-authored `summary` (the "what I concluded and why" reasoning),
 * and filters by mission. Modeled on DogfoodHealthPanel's fetch pattern and ws idiom.
 *
 * Live rows arrive over the `conductor_pass` websocket event. They are PREPENDED only while
 * the user is on page 1 (offset 0) — prepending underneath someone reading page 3 would shift
 * every row they are looking at. On any later page the rows are held and announced as an
 * unobtrusive "N new passes" affordance that jumps back to page 1.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLoadedState } from '@/hooks/useLoadedState';
import { getWebSocketClient } from '@/lib/websocket';
import {
  fetchConductorJournalWithNicknames,
  groupConductorPasses,
  ConductorPassGroup,
  ConductorPassRow,
} from '@/lib/conductorActivity';
import { EntityChip } from './EntityChip';
import { humanizeIds } from '@/lib/entityNickname';

const ALL_MISSIONS = '__all__';
export const CONDUCTOR_RAW_MODE_KEY = 'collab.conductorActivity.rawMode';
/** Rows per page. 25 keeps the Bridge rail scrollable-but-short and the OFFSET query cheap. */
export const CONDUCTOR_PAGE_SIZE = 25;

function formatHM(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const ConductorActivityPanel: React.FC<{
  project: string;
  missionOptions?: { id: string; label: string }[];
  onOpenEntity: (kind: string, id: string) => void;
}> = ({ project, missionOptions, onOpenEntity }) => {
  const loaded = useLoadedState<ConductorPassRow[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [selectedMission, setSelectedMission] = useState<string>(ALL_MISSIONS);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  /** Live rows that arrived while the user was NOT on page 1. Held, never spliced in. */
  const [pendingRows, setPendingRows] = useState<ConductorPassRow[]>([]);
  /** Mission ids ever seen, so the filter's options don't vanish once the fetch is narrowed. */
  const [seenMissions, setSeenMissions] = useState<string[]>([]);
  const [rawMode, setRawMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CONDUCTOR_RAW_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // The WS effect subscribes ONCE; reading `page` inside it would capture 0 forever.
  const pageRef = useRef(page);
  pageRef.current = page;

  // A new project invalidates both the offset and the mission filter (mission ids are
  // per-project). Setting the same values is a no-op render for React on mount.
  useEffect(() => {
    setPage(0);
    setSelectedMission(ALL_MISSIONS);
    setPendingRows([]);
  }, [project]);

  // Fetch the current page: on mount and whenever project, mission filter or page changes.
  useEffect(() => {
    let cancelled = false;
    loaded.reset();
    fetchConductorJournalWithNicknames(project, {
      missionId: selectedMission === ALL_MISSIONS ? undefined : selectedMission,
      limit: CONDUCTOR_PAGE_SIZE,
      offset: page * CONDUCTOR_PAGE_SIZE,
    })
      .then((r) => {
        if (!cancelled) {
          loaded.settle(r.rows);
          setNicknames(r.nicknames);
          setTotal(r.total);
          setSeenMissions((prev) => {
            const next = new Set(prev);
            r.rows.forEach((row) => {
              if (row.missionId) next.add(row.missionId);
            });
            return next.size === prev.length ? prev : Array.from(next);
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          loaded.fail(new Error('Failed to fetch conductor journal'));
          setNicknames({});
          setTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project, selectedMission, page]);

  // WS subscribe once: prepend new rows for this project on page 1, hold them on later pages.
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'conductor_pass' && msg.project === project) {
        if (pageRef.current === 0) {
          // Functional update: this effect subscribes once, so `loaded.data` here would be the
          // mount-time array forever now that settle is referentially stable.
          loaded.update((prev) => [msg.row, ...prev]);
          setTotal((t) => t + 1);
        } else {
          setPendingRows((prev) => [msg.row, ...prev]);
        }
      }
    });
    return () => sub.unsubscribe();
  }, [project, loaded.update]);

  const missionMap = new Map<string, string>();
  (missionOptions ?? []).forEach((m) => missionMap.set(m.id, m.label));
  seenMissions.forEach((id) => {
    if (!missionMap.has(id)) missionMap.set(id, id);
  });
  loaded.data.forEach((r) => {
    if (r.missionId && !missionMap.has(r.missionId)) {
      missionMap.set(r.missionId, r.missionId);
    }
  });
  const missionEntries = Array.from(missionMap.entries());

  // The server already narrows by mission; this keeps the client honest for live-prepended
  // rows (which arrive unfiltered) and for any response that predates the server-side filter.
  const filteredRows =
    selectedMission === ALL_MISSIONS ? loaded.data : loaded.data.filter((r) => r.missionId === selectedMission);

  const pendingCount =
    selectedMission === ALL_MISSIONS
      ? pendingRows.length
      : pendingRows.filter((r) => r.missionId === selectedMission).length;

  const pageCount = Math.max(1, Math.ceil(total / CONDUCTOR_PAGE_SIZE));
  const canPrev = page > 0;
  const canNext = page + 1 < pageCount;

  const goToPage = (next: number) => {
    setPendingRows([]);
    setPage(next);
  };

  return (
    <div data-testid="conductor-activity-panel">
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">conductor activity</span>
        <button
          type="button"
          data-testid="conductor-raw-toggle"
          onClick={() =>
            setRawMode((v) => {
              const next = !v;
              try {
                window.localStorage.setItem(CONDUCTOR_RAW_MODE_KEY, next ? '1' : '0');
              } catch {
                // ignore
              }
              return next;
            })
          }
          className="ml-auto text-3xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {rawMode ? 'raw' : 'nicknames'}
        </button>
        <select
          data-testid="conductor-mission-filter"
          value={selectedMission}
          onChange={(e) => {
            // A page-3 offset is meaningless under a different filter — always restart at page 1.
            setPage(0);
            setPendingRows([]);
            setSelectedMission(e.target.value);
          }}
          className="text-2xs"
        >
          <option value={ALL_MISSIONS}>All missions</option>
          {missionEntries.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {pendingCount > 0 && (
        <div className="px-3 pb-1">
          <button
            type="button"
            data-testid="conductor-pending-passes"
            onClick={() => goToPage(0)}
            className="text-3xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            {`↑ ${pendingCount} new ${pendingCount === 1 ? 'pass' : 'passes'}`}
          </button>
        </div>
      )}

      {!loaded.hasLoadedOnce ? (
        <p data-testid="conductor-activity-loading" className="text-2xs text-gray-400 dark:text-gray-500 italic px-3 pb-3">
          Loading…
        </p>
      ) : filteredRows.length === 0 ? (
        <p className="text-2xs text-gray-400 dark:text-gray-500 italic px-3 pb-3">
          No conductor passes yet.
        </p>
      ) : (
        <div className="px-3 pb-3">
          {groupConductorPasses(filteredRows).map((group: ConductorPassGroup<ConductorPassRow>) => {
            const formatted = group.formatted;
            // Absent OR blank summary renders NOTHING — no empty box, no placeholder noise.
            const summary = group.representative.summary?.trim();
            return (
              <div
                key={group.representative.id}
                data-testid="conductor-pass-entry"
                data-pass-id={group.representative.id}
                data-mission-id={group.representative.missionId ?? ''}
                className="py-1 border-b border-gray-200/50 dark:border-gray-700/50"
              >
                <div className="flex items-center gap-1">
                  {group.representative.endedAt === null && (
                    <span data-testid="conductor-pass-live" className="text-3xs px-1 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      live
                    </span>
                  )}
                </div>
                <div className="text-2xs text-gray-700 dark:text-gray-200">
                  {rawMode ? formatted.sentence : humanizeIds(formatted.sentence, nicknames)}
                </div>
                {summary && (
                  <div
                    data-testid="conductor-pass-summary"
                    className="text-3xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words mt-0.5"
                  >
                    {rawMode ? summary : humanizeIds(summary, nicknames)}
                  </div>
                )}
                <div className="text-3xs text-gray-500">
                  {group.arm ?? 'no arm'} → {group.outcome ?? 'pending'}
                </div>
                <div className="text-3xs text-gray-400">
                  {new Date(group.representative.startedAt).toLocaleString()}
                </div>
                {group.count > 1 && (
                  <div data-testid="conductor-pass-repeat" className="text-3xs text-gray-400">
                    {`↻ ×${group.count} · ${formatHM(group.firstStartedAt)}–${formatHM(group.lastStartedAt)}`}
                  </div>
                )}
                <div className="flex items-center gap-1 mt-1">
                  {formatted.chips.map((chip) => (
                    <EntityChip
                      key={`${chip.kind}-${chip.id}`}
                      kind={chip.kind}
                      id={chip.id}
                      nicknames={nicknames}
                      onOpen={onOpenEntity}
                      raw={rawMode}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loaded.hasLoadedOnce && (canPrev || canNext) && (
        <div data-testid="conductor-pagination" className="px-3 pb-3 flex items-center gap-2">
          <button
            type="button"
            data-testid="conductor-page-prev"
            disabled={!canPrev}
            onClick={() => goToPage(page - 1)}
            className="text-3xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            ← prev
          </button>
          <span data-testid="conductor-page-label" className="text-3xs text-gray-400">
            {`page ${page + 1} of ${pageCount}`}
          </span>
          <button
            type="button"
            data-testid="conductor-page-next"
            disabled={!canNext}
            onClick={() => goToPage(page + 1)}
            className="text-3xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            next →
          </button>
        </div>
      )}
    </div>
  );
};

export default ConductorActivityPanel;
