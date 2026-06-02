import React, { useState, useEffect } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';

export interface SupervisorOnboardingProps {
  serverId: string;
  state: 'none' | 'crashed';
  lastSession?: string;
  onStarted?: () => void;
}

export const SupervisorOnboarding: React.FC<SupervisorOnboardingProps> = ({
  serverId,
  state,
  lastSession,
  onStarted,
}) => {
  const config = useSupervisorStore((s) => s.config);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);
  const saveConfig = useSupervisorStore((s) => s.saveConfig);

  const [supervisorProject, setSupervisorProject] = useState('');
  const [supervisorSession, setSupervisorSession] = useState('');
  const [starting, setStarting] = useState(false);

  // Load config on mount
  useEffect(() => {
    void loadConfig(serverId);
  }, [serverId, loadConfig]);

  // Sync inputs when config arrives
  useEffect(() => {
    if (config) {
      setSupervisorProject(config.supervisorProject ?? '');
      setSupervisorSession(config.supervisorSession ?? '');
    }
  }, [config]);

  const handleLaunch = async () => {
    setStarting(true);
    try {
      await saveConfig(serverId, supervisorProject, supervisorSession);
      const launchBody = {
        project: supervisorProject,
        session: supervisorSession,
        role: 'supervisor',
        invokeSkill: '/supervisor',
        allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid',
      };
      const mc = (window as any).mc;
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(serverId, {
          path: '/api/ide/launch-session',
          method: 'POST',
          body: launchBody,
        });
      } else {
        await fetch('/api/ide/launch-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(launchBody),
        });
      }
      onStarted?.();
    } catch {
      /* best-effort */
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm p-5 space-y-4">
        {/* Icon + heading */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-3xl" role="img" aria-label="shield">🛡</span>
          {state === 'none' ? (
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Become the Supervisor
            </h2>
          ) : (
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Supervisor — not running
            </h2>
          )}
        </div>

        {state === 'none' ? (
          <>
            {/* Description */}
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
              One foreground session that plans roadmaps with you and oversees your worker sessions —
              nudging idle ones, escalating decisions to you, never answering on your behalf.
            </p>

            {/* Will / won't list */}
            <div className="rounded border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 px-3 py-2 space-y-1">
              <div className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 pb-0.5">
                Will
              </div>
              {[
                'Watch sessions',
                'Nudge idle workers',
                'Escalate decisions to you',
              ].map((item) => (
                <div key={item} className="flex items-start gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                  <span className="text-success-500 mt-px">✓</span>
                  <span>{item}</span>
                </div>
              ))}
              <div className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 pt-1.5 pb-0.5">
                Won&apos;t
              </div>
              {[
                'Answer prompts',
                'Make decisions for you',
              ].map((item) => (
                <div key={item} className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="text-danger-400 mt-px">✗</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            {/* Inputs */}
            <div className="space-y-2">
              <div>
                <label className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Supervisor session
                </label>
                <input
                  type="text"
                  value={supervisorSession}
                  onChange={(e) => setSupervisorSession(e.target.value)}
                  placeholder="e.g. supervisor"
                  className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-info-400 dark:focus:ring-info-500 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Project scope
                </label>
                <input
                  type="text"
                  value={supervisorProject}
                  onChange={(e) => setSupervisorProject(e.target.value)}
                  placeholder="e.g. /path/to/project"
                  className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-info-400 dark:focus:ring-info-500 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
            </div>

            {/* Primary action */}
            <button
              onClick={() => void handleLaunch()}
              disabled={starting || !supervisorProject || !supervisorSession}
              className="w-full py-2 px-4 text-xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting ? 'Starting…' : 'Start supervising'}
            </button>
          </>
        ) : (
          <>
            {/* Crashed state */}
            {lastSession && (
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Last seen: <span className="font-mono text-gray-700 dark:text-gray-300">{lastSession}</span>
              </p>
            )}

            <div className="space-y-2">
              <div>
                <label className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Supervisor session
                </label>
                <input
                  type="text"
                  value={supervisorSession}
                  onChange={(e) => setSupervisorSession(e.target.value)}
                  placeholder="e.g. supervisor"
                  className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-info-400 dark:focus:ring-info-500 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Project scope
                </label>
                <input
                  type="text"
                  value={supervisorProject}
                  onChange={(e) => setSupervisorProject(e.target.value)}
                  placeholder="e.g. /path/to/project"
                  className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-info-400 dark:focus:ring-info-500 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void handleLaunch()}
                disabled={starting || !supervisorProject || !supervisorSession}
                className="flex-1 py-2 px-3 text-xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {starting ? 'Restarting…' : 'Restart supervisor'}
              </button>
              <button
                disabled
                className="py-2 px-3 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 cursor-not-allowed opacity-60"
                title="Open supervisor console (visual only)"
              >
                Open console
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
