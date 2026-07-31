/**
 * ConductorActivityPanel — read-only conductor-pass journal surface for the Bridge.
 * Fetch-on-mount / on-project-change, prepends new rows pushed over the `conductor_pass`
 * websocket event, and filters client-side by mission. Modeled on DogfoodHealthPanel's
 * fetch pattern and ws subscription idiom.
 */
import React, { useEffect, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { fetchConductorJournal, formatConductorPass, ConductorPassRow } from '@/lib/conductorActivity';

const ALL_MISSIONS = '__all__';

export const ConductorActivityPanel: React.FC<{
  project: string;
  missionOptions?: { id: string; label: string }[];
  onOpenEntity: (kind: string, id: string) => void;
}> = ({ project, missionOptions, onOpenEntity }) => {
  const [rows, setRows] = useState<ConductorPassRow[]>([]);
  const [selectedMission, setSelectedMission] = useState<string>(ALL_MISSIONS);

  // Fetch on mount and whenever project changes
  useEffect(() => {
    let cancelled = false;
    fetchConductorJournal(project)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  // WS subscribe once: prepend new rows for this project, no refetch
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'conductor_pass' && msg.project === project) {
        setRows((prev) => [msg.row, ...prev]);
      }
    });
    return () => sub.unsubscribe();
  }, [project]);

  const missionMap = new Map<string, string>();
  (missionOptions ?? []).forEach((m) => missionMap.set(m.id, m.label));
  rows.forEach((r) => {
    if (r.missionId && !missionMap.has(r.missionId)) {
      missionMap.set(r.missionId, r.missionId);
    }
  });
  const missionEntries = Array.from(missionMap.entries());

  const filteredRows =
    selectedMission === ALL_MISSIONS ? rows : rows.filter((r) => r.missionId === selectedMission);

  return (
    <div data-testid="conductor-activity-panel">
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">conductor activity</span>
        <select
          data-testid="conductor-mission-filter"
          value={selectedMission}
          onChange={(e) => setSelectedMission(e.target.value)}
          className="ml-auto text-2xs"
        >
          <option value={ALL_MISSIONS}>All missions</option>
          {missionEntries.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-2xs text-gray-400 dark:text-gray-500 italic px-3 pb-3">
          No conductor passes yet.
        </p>
      ) : (
        <div className="px-3 pb-3">
          {filteredRows.map((row) => {
            const formatted = formatConductorPass(row);
            return (
              <div
                key={row.id}
                data-testid="conductor-pass-entry"
                data-pass-id={row.id}
                data-mission-id={row.missionId ?? ''}
                className="py-1 border-b border-gray-200/50 dark:border-gray-700/50"
              >
                <div className="text-2xs text-gray-700 dark:text-gray-200">{formatted.sentence}</div>
                <div className="text-3xs text-gray-400">{new Date(row.startedAt).toLocaleString()}</div>
                <div className="flex items-center gap-1 mt-1">
                  {formatted.chips.map((chip) => (
                    <button
                      key={`${chip.kind}-${chip.id}`}
                      type="button"
                      data-testid={`conductor-chip-${chip.kind}-${chip.id}`}
                      onClick={() => onOpenEntity(chip.kind, chip.id)}
                      className="text-2xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ConductorActivityPanel;
