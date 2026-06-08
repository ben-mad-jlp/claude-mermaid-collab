/**
 * HeaderRoleSwitches — the two fleet-global role controls (Steward, Supervisor)
 * rendered in the MAIN app header. The Steward is a 3-way mode slider
 * (off / auto / dogfood); the Supervisor is an on/off slider (start/stop the
 * role). The per-project Coordinator switch stays in the Bridge screen.
 *
 * Self-contained: polls steward identity + supervisor liveness/config on the
 * same 10s cadence as the panels, so it works whether or not the left-column
 * panels are mounted.
 */
import React, { useEffect } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { ModeSlider } from '@/components/supervisor/ModeSlider';

export const HeaderRoleSwitches: React.FC = () => {
  const serverScope = useSessionStore((s) => s.currentSession)?.serverId ?? 'local';

  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const supLiveness = useSupervisorStore((s) => s.liveness);
  const config = useSupervisorStore((s) => s.config);
  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const loadLiveness = useSupervisorStore((s) => s.loadLiveness);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);
  const setStewardMode = useSupervisorStore((s) => s.setStewardMode);
  const startRole = useSupervisorStore((s) => s.startRole);
  const stopRole = useSupervisorStore((s) => s.stopRole);

  useEffect(() => {
    const refresh = () => {
      void loadStewardIdentity(serverScope);
      void loadLiveness(serverScope);
      void loadConfig(serverScope);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, loadStewardIdentity, loadLiveness, loadConfig]);

  const stewardMode = stewardLiveness?.mode ?? (stewardLiveness?.switchedOn !== false ? 'auto' : 'off');
  const supConfigured = !!config?.supervisorProject && !!config?.supervisorSession;
  const supOn = !!supLiveness?.running;

  const onSupervisor = async (on: boolean) => {
    if (on) {
      if (supConfigured) await startRole(serverScope, 'supervisor', config!.supervisorProject, config!.supervisorSession);
    } else {
      await stopRole(serverScope, 'supervisor');
    }
    void loadLiveness(serverScope);
  };

  return (
    <div className="flex items-center gap-3" data-testid="header-role-switches">
      {/* Steward — 3-way mode */}
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Steward</span>
        <div className="w-36">
          <ModeSlider
            data-testid="steward-mode-slider"
            accent="success"
            value={stewardMode}
            onChange={(m) => void setStewardMode(serverScope, m)}
            options={[
              { value: 'off', label: 'off', title: 'OFF — escalations all wait in your queue.' },
              { value: 'auto', label: 'auto', title: 'AUTO — auto-answer escalations (may override the gate).' },
              { value: 'dogfood', label: 'dogfood', title: 'DOGFOOD — auto-answer + proactively drive/build the queue.' },
            ]}
          />
        </div>
      </div>
      {/* Supervisor — on/off */}
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Supervisor</span>
        <div className="w-20">
          <ModeSlider
            data-testid="supervisor-onoff-slider"
            accent="success"
            value={supOn ? 'on' : 'off'}
            disabled={!supOn && !supConfigured}
            onChange={(v) => void onSupervisor(v === 'on')}
            options={[
              { value: 'off', label: 'off', title: 'OFF — stop the supervisor.' },
              { value: 'on', label: 'on', title: supConfigured ? 'ON — start the supervisor.' : 'Set up the Supervisor in its panel first.' },
            ]}
          />
        </div>
      </div>
    </div>
  );
};

export default HeaderRoleSwitches;
