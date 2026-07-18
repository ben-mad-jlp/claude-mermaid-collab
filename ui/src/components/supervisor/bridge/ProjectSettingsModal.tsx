/**
 * ProjectSettingsModal — the SINGLE home for ALL per-project daemon settings.
 *
 * Opened by the gear button in the CommandBar header. Gathers what used to be
 * scattered across the CommandBar (⚙ nodes matrix, concurrency, autonomy ladder)
 * and the MissionDetailPanel's "Daemon controls" toggle into one grouped,
 * dismissible modal scoped to the active project.
 *
 * Groups: Concurrency · Node models & provider · Watchdog ·
 * Context recycle · Prompt injection (advisory). Each control talks to its own
 * per-project REST route; nothing here is global.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { PoolSizeControl } from './PoolSizeControl';
import { DaemonNodesMatrix } from '@/components/settings/DaemonNodesMatrix';
import { DaemonProviderControl } from '@/components/settings/DaemonProviderControl';
import { apiGet, apiPost, useConductorEnabled } from './useConductorEnabled';

// ── Watchdog threshold control ───────────────────────────────────────────────
const WatchdogControl: React.FC<{ project: string }> = ({ project }) => {
  const [value, setValue] = useState<number | null>(null); // null = default/off
  const [def, setDef] = useState<number>(80);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const data = await apiGet(`/api/supervisor/watchdog-threshold?project=${encodeURIComponent(project)}`);
      if (cancelled) return;
      if (typeof data.thresholdPercent === 'number') setValue(data.thresholdPercent);
      else setValue(null);
      if (typeof data.default === 'number') setDef(data.default);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const commit = useCallback((next: number | null) => {
    if (busy || !project) return;
    setBusy(true);
    setValue(next);
    void (async () => {
      const data = await apiPost('/api/supervisor/watchdog-threshold', { project, thresholdPercent: next });
      if (typeof data?.thresholdPercent === 'number') setValue(data.thresholdPercent);
      else if (data?.thresholdPercent === null) setValue(null);
      setBusy(false);
    })();
  }, [busy, project]);

  return (
    <div data-testid="watchdog-control" className={`flex items-center gap-2 text-3xs ${busy ? 'opacity-60' : ''}`}>
      <input
        type="number"
        min={1}
        max={100}
        value={value ?? ''}
        placeholder={`default ${def}`}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v === '' ? null : Math.max(1, Math.min(100, Number(v))));
        }}
        onBlur={() => commit(value)}
        data-testid="watchdog-threshold-input"
        className="w-16 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 tabular-nums"
      />
      <span className="text-gray-500 dark:text-gray-400">% context → recycle trigger</span>
      <button
        type="button"
        data-testid="watchdog-threshold-clear"
        onClick={() => commit(null)}
        disabled={busy || value === null}
        className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
        title="Clear override — revert to the default threshold"
      >
        default
      </button>
    </div>
  );
};

// ── Context-recycle mode segmented control ───────────────────────────────────
type RecycleMode = 'off' | 'notify' | 'force';
const RECYCLE_MODES: RecycleMode[] = ['off', 'notify', 'force'];
const RECYCLE_TITLE: Record<RecycleMode, string> = {
  off: 'Off — never auto-recycle a session over threshold',
  notify: 'Notify — surface a recycle suggestion, but do not act',
  force: 'Force — auto-recycle the session when it crosses the threshold',
};

const ContextRecycleControl: React.FC<{ project: string }> = ({ project }) => {
  const [mode, setMode] = useState<RecycleMode>('off');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const data = await apiGet(`/api/supervisor/context-recycle?project=${encodeURIComponent(project)}`);
      if (!cancelled && RECYCLE_MODES.includes(data.mode)) setMode(data.mode);
    })();
    return () => { cancelled = true; };
  }, [project]);

  const select = useCallback((next: RecycleMode) => {
    if (busy || !project || next === mode) return;
    const prev = mode;
    setMode(next);
    setBusy(true);
    void (async () => {
      const data = await apiPost('/api/supervisor/context-recycle', { project, mode: next });
      if (RECYCLE_MODES.includes(data?.mode)) setMode(data.mode);
      else setMode(prev);
      setBusy(false);
    })();
  }, [busy, project, mode]);

  return (
    <div
      data-testid="context-recycle-control"
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none border-gray-300 dark:border-gray-600 ${busy ? 'opacity-60' : ''}`}
    >
      {RECYCLE_MODES.map((m, idx) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            data-testid={`context-recycle-${m}`}
            data-active={active}
            onClick={() => select(m)}
            title={RECYCLE_TITLE[m]}
            className={`px-2 py-0.5 transition-colors cursor-pointer ${idx > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''} ${
              active
                ? 'bg-info-500 dark:bg-info-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
};

// ── Prompt-injection flag toggles ────────────────────────────────────────────
type InjectFlag = 'digest' | 'retryContext' | 'activeConstraints';
const INJECT_FLAGS: { flag: InjectFlag; label: string; hint: string }[] = [
  { flag: 'digest', label: 'Project digest', hint: 'Inject a per-project digest into leaf prompts.' },
  { flag: 'retryContext', label: 'Retry context', hint: 'Inject the prior attempt’s failure context on retry.' },
  { flag: 'activeConstraints', label: 'Active constraints', hint: 'Inject the project’s active constraints into prompts.' },
];

const InjectionFlags: React.FC<{ project: string }> = ({ project }) => {
  const [flags, setFlags] = useState<Record<InjectFlag, boolean>>({
    digest: false,
    retryContext: false,
    activeConstraints: false,
  });
  const [busy, setBusy] = useState<InjectFlag | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void (async () => {
      const data = await apiGet(`/api/supervisor/injection-flags?project=${encodeURIComponent(project)}`);
      if (cancelled) return;
      setFlags({
        digest: !!data.digest,
        retryContext: !!data.retryContext,
        activeConstraints: !!data.activeConstraints,
      });
    })();
    return () => { cancelled = true; };
  }, [project]);

  const toggle = useCallback((flag: InjectFlag, value: boolean) => {
    if (!project) return;
    setBusy(flag);
    setFlags((f) => ({ ...f, [flag]: value })); // optimistic
    void (async () => {
      const data = await apiPost('/api/supervisor/injection-flags', { project, flag, value });
      if (data && typeof data.digest === 'boolean') {
        setFlags({
          digest: !!data.digest,
          retryContext: !!data.retryContext,
          activeConstraints: !!data.activeConstraints,
        });
      }
      setBusy(null);
    })();
  }, [project]);

  return (
    <div className="flex flex-col gap-2">
      {INJECT_FLAGS.map(({ flag, label, hint }) => (
        <label key={flag} className="flex items-center gap-2 text-3xs text-gray-700 dark:text-gray-200 cursor-pointer" title={hint}>
          <input
            type="checkbox"
            data-testid={`inject-flag-${flag}`}
            checked={flags[flag]}
            disabled={busy === flag}
            onChange={(e) => toggle(flag, e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
          />
          <span className="font-medium">{label}</span>
          <span className="text-gray-400 dark:text-gray-500">{hint}</span>
        </label>
      ))}
    </div>
  );
};

// ── Autonomous conductor toggle ──────────────────────────────────────────────
const ConductorControl: React.FC<{ project: string }> = ({ project }) => {
  const { enabled, busy, setEnabled } = useConductorEnabled(project);

  return (
    <label className="flex items-center gap-2 text-3xs text-gray-700 dark:text-gray-200 cursor-pointer" title="Let the conductor drive this project's missions autonomously, including landing.">
      <input
        type="checkbox"
        data-testid="conductor-toggle"
        checked={!!enabled}
        disabled={busy}
        onChange={(e) => void setEnabled(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
      />
      <span className="font-medium">Autonomous conductor</span>
      <span className="text-gray-400 dark:text-gray-500">Let the conductor drive this project's missions autonomously, including landing.</span>
    </label>
  );
};

// ── Section wrapper ──────────────────────────────────────────────────────────
const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-2">
    <div className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
    {children}
  </div>
);

export interface ProjectSettingsModalProps {
  project: string;
  open: boolean;
  onClose: () => void;
}

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({ project, open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        data-testid="project-settings-modal"
        role="dialog"
        aria-label="Project settings"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Project settings</span>
            <span className="text-3xs text-gray-500 dark:text-gray-400 truncate" title={project}>{project}</span>
          </div>
          <button
            type="button"
            data-testid="project-settings-close"
            aria-label="Close project settings"
            onClick={onClose}
            className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 p-4">
          <Section label="Concurrency">
            <PoolSizeControl project={project} />
          </Section>

          <Section label="Node models &amp; provider">
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 bg-white/60 dark:bg-gray-900/40">
              <div className="mb-2 pb-2 border-b border-gray-200/70 dark:border-gray-700/70">
                <DaemonProviderControl project={project} />
              </div>
              <DaemonNodesMatrix project={project} />
            </div>
          </Section>

          <Section label="Watchdog">
            <WatchdogControl project={project} />
          </Section>

          <Section label="Autonomous conductor">
            <ConductorControl project={project} />
          </Section>

          <Section label="Context recycle">
            <ContextRecycleControl project={project} />
          </Section>

          <Section label="Prompt injection (advisory)">
            <InjectionFlags project={project} />
          </Section>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsModal;
