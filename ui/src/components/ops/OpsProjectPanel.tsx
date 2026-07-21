import React, { useEffect, useState } from 'react';
import { useSupervisorStore, type DeployStatus } from '@/stores/supervisorStore';
import { useOpsData } from '@/hooks/useOpsData';
import { ClaudePixAvatar } from '@/components/layout/SessionCard';
import { fleetStateToStatus } from '@/hooks/useFleetStatus';

interface OpsProjectPanelProps {
  project: string;
  serverScope: string;
}

function daemonStateToStatus(state: string | undefined): 'active' | 'waiting' | 'permission' | 'unknown' {
  switch (state) {
    case 'working': return 'active';
    case 'blocked-on-decision': return 'permission';
    case 'claims-suppressed':
    case 'claimable':
    case 'idle': return 'waiting';
    default: return 'unknown';
  }
}

export const OpsProjectPanel: React.FC<OpsProjectPanelProps> = ({ project, serverScope }) => {
  const { approveMission, activateMission, verifyEpic, fetchDeployStatus, deploySelf } =
    useSupervisorStore();
  const data = useOpsData(serverScope, project);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);

  useEffect(() => {
    const poll = async () => {
      const status = await fetchDeployStatus(serverScope, project);
      setDeployStatus(status);
    };

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => clearInterval(id);
  }, [serverScope, project, fetchDeployStatus]);

  const fleetEntries = Object.values(data.fleet);
  const workingCount = fleetEntries.filter((e) => e.state === 'working').length;
  const idleCount = fleetEntries.filter((e) => e.state === 'idle').length;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">{project}</h3>
        <ClaudePixAvatar status={daemonStateToStatus(data.daemon?.state)} size={32} />
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {/* Fleet Status */}
        {fleetEntries.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
              Fleet ({fleetEntries.length})
            </div>
            <div className="text-sm space-y-1 text-gray-600 dark:text-gray-300 mb-3">
              <div>Working: {workingCount}</div>
              <div>Idle: {idleCount}</div>
            </div>
            <div className="space-y-2">
              {fleetEntries.map((entry) => (
                <div key={entry.worker} className="flex items-center gap-2">
                  <ClaudePixAvatar status={fleetStateToStatus(entry.state)} size={28} />
                  <span className="text-sm text-gray-600 dark:text-gray-300">{entry.worker}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daemon Status */}
        {data.daemon && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
              Daemon
            </div>
            <div className="text-sm space-y-1 text-gray-600 dark:text-gray-300">
              <div>State: {data.daemon.state || 'unknown'}</div>
              <div>Inflight: {data.daemon.inflight?.length || 0}</div>
            </div>
          </div>
        )}

        {/* Burn Status */}
        {data.burn && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
              Token Burn
            </div>
            <div className="text-sm space-y-1 text-gray-600 dark:text-gray-300">
              {data.burn.sources.length > 0 ? (
                <div>
                  {data.burn.sources.map((source: any, i: number) => (
                    <div key={i}>{source.label || source.name}: {source.value}</div>
                  ))}
                </div>
              ) : (
                <div>No active sources</div>
              )}
            </div>
          </div>
        )}

        {/* Deploy Status */}
        {deployStatus && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
              Deploy
            </div>
            <div className="space-y-2">
              <button
                onClick={() => deploySelf(serverScope, project)}
                disabled={!deployStatus.canDeploy}
                className="w-full px-3 py-2 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Deploy
              </button>
              {deployStatus.deployBlockedReason && (
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  {deployStatus.deployBlockedReason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Missions */}
        {data.missions.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-3">
              Missions ({data.missions.length})
            </div>
            <div className="space-y-3">
              {data.missions.map((mission) => (
                <div
                  key={mission.node.id}
                  className="p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    {mission.node.title}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {mission.rollup.status === 'unapproved' && (
                      <button
                        onClick={() =>
                          approveMission(serverScope, project, mission.mission.todoId)
                        }
                        className="px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60"
                      >
                        Approve
                      </button>
                    )}
                    {mission.rollup.status !== 'unapproved' && !mission.mission.active && (
                      <button
                        onClick={() =>
                          activateMission(serverScope, project, mission.mission.todoId)
                        }
                        className="px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
                      >
                        Activate
                      </button>
                    )}
                    {mission.epics.map((epic) => (
                      <button
                        key={epic.id}
                        onClick={() => verifyEpic(serverScope, project, epic.id)}
                        className="px-2 py-1 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60"
                      >
                        Verify {epic.id.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
