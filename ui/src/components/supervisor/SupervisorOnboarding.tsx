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

  // Minimal front door: a single Start/Restart button. Project + session come
  // from the server config (defaults to the dedicated supervisor workspace), so
  // no name/location inputs or description are needed.
  const ready = !!(supervisorProject && supervisorSession);
  const label =
    state === 'none'
      ? starting
        ? 'Starting…'
        : 'Start supervisor'
      : starting
        ? 'Restarting…'
        : 'Restart supervisor';

  return (
    <div className="px-3 pb-2">
      <button
        data-testid="supervisor-start"
        onClick={() => void handleLaunch()}
        disabled={starting || !ready}
        className="w-full py-1.5 px-3 text-xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {label}
      </button>
      {state === 'crashed' && lastSession && (
        <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500 text-center">
          Last seen: <span className="font-mono">{lastSession}</span>
        </p>
      )}
    </div>
  );
};
