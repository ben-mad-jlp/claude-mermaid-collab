import React, { useState, useEffect } from 'react';
import { stripKindPrefix } from '@/lib/todoKind';
import { type MissionSummary, type MissionPhase, type MissionStatus, useSupervisorStore } from '@/stores/supervisorStore';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

/** Phase → pill classes. 'converged' is loud green; the rest reuse the board's
 *  neutral/info/violet/amber token families so the strip reads as one system. */
export const PHASE_STYLE: Record<MissionPhase, string> = {
  discover:  'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  plan:      'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  execute:   'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  verify:    'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  converged: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  stopped:   'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export const PHASE_LABEL: Record<MissionPhase, string> = {
  discover: 'Discover',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  converged: 'Converged',
  stopped: 'Stopped',
};

/** The canonical agentic loop, in order — used to build the phase tooltip. */
export const PHASE_CYCLE: MissionPhase[] = ['discover', 'plan', 'execute', 'verify'];

export function phaseTooltip(phase: MissionPhase): string {
  const cycle = PHASE_CYCLE.map((p) => PHASE_LABEL[p]).join(' → ');
  const current = PHASE_LABEL[phase] ?? phase;
  return `Convergence loop: ${cycle} → (iterate: loop back).\nVerify decides: converged / stopped / loop again.\nCurrent phase: ${current}.`;
}

export const isTerminalPhase = (p: MissionPhase): boolean => p === 'converged' || p === 'stopped';

/** Status → pill classes. Status is the derived capability state of the mission. */
export const STATUS_STYLE: Record<MissionStatus, string> = {
  converged:        'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  building:         'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  'needs-verify':   'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'needs-discovery': 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  unapproved:       'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  blocked:          'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  'over-budget':    'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  abandoned:        'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export const STATUS_LABEL: Record<MissionStatus, string> = {
  converged:        'Converged',
  building:         'Building',
  'needs-verify':   'Needs verify',
  'needs-discovery': 'Needs discovery',
  unapproved:       'Unapproved',
  blocked:          'Blocked',
  'over-budget':    'Over budget',
  abandoned:        'Abandoned',
};

export function statusTooltip(status: MissionStatus): string {
  const tooltips: Record<MissionStatus, string> = {
    converged: 'All criteria met — goal achieved.',
    building: 'A serving epic is building; the conductor is correctly waiting.',
    'needs-verify': 'A serving epic landed but a criterion is not yet independently verified.',
    'needs-discovery': 'The mission needs discovery work to identify what to build.',
    unapproved: 'Forged but not yet approved — the mission loop will not drive it until approved.',
    blocked: 'A criterion is blocked and needs attention.',
    'over-budget': 'The mission has exceeded its iteration budget.',
    abandoned: 'The mission has been abandoned.',
  };
  return tooltips[status] ?? status;
}

/** StatusPill component — renders the derived mission status with color coding. */
export const StatusPill: React.FC<{ status: MissionStatus }> = ({ status }) => (
  <span
    data-testid="mission-status-pill"
    className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${STATUS_STYLE[status]}`}
    title={statusTooltip(status)}
  >
    {STATUS_LABEL[status]}
  </span>
);

/** Board-ish status → dot colour for an epic row. */
export function epicDotClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'accepted') return 'bg-success-500';
  if (s === 'blocked' || s === 'rejected' || s === 'failed') return 'bg-warning-500';
  if (s === 'in_progress' || s === 'building' || s === 'active') return 'bg-info-500';
  return 'bg-gray-300 dark:bg-gray-600';
}

// ── small shared UI primitives ───────────────────────────────────────────────

/** A tiny text-button used for the card action row. */
export const MiniButton: React.FC<{
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  testid?: string;
  children: React.ReactNode;
}> = ({ onClick, title, disabled, tone = 'default', testid, children }) => {
  const toneCls =
    tone === 'primary'
      ? 'text-info-700 dark:text-info-300 hover:bg-info-50 dark:hover:bg-info-900/30 border-info-200 dark:border-info-800'
      : tone === 'danger'
      ? 'text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 border-danger-200 dark:border-danger-800'
      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testid}
      className={`text-3xs px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneCls}`}
    >
      {children}
    </button>
  );
};

/** Modal shell matching ConfirmDialog styling. */
export const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({
  title,
  onClose,
  children,
  footer,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    role="dialog"
    aria-modal="true"
    onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
  >
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="p-6 flex flex-col gap-4">{children}</div>
      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">{footer}</div>
    </div>
  </div>
);

export const fieldCls =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-info-500 outline-none';
export const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-300 mb-1 block';
export const primaryBtnCls =
  'px-4 py-2 text-sm font-medium rounded-lg bg-info-600 text-white hover:bg-info-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
export const cancelBtnCls =
  'px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors';

/** Parse a maxIterations input: '' → null (no cap); a positive int → that; else undefined (invalid, ignored). */
export function parseCap(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// ── Edit dialog (goal / description / procedure / cap) ────────────────────────

export const MissionEditDialog: React.FC<{
  m: MissionSummary;
  onClose: () => void;
  onSave: (patch: { title?: string; description?: string; maxIterations?: number | null; procedure?: string | null }) => Promise<void>;
}> = ({ m, onClose, onSave }) => {
  const [title, setTitle] = useState(stripKindPrefix(m.node?.title));
  const [description, setDescription] = useState((m.mission?.description as string | undefined) ?? '');
  const [procedure, setProcedure] = useState(m.mission?.procedure ?? '');
  const [cap, setCap] = useState(m.mission?.maxIterations != null ? String(m.mission.maxIterations) : '');
  const [busy, setBusy] = useState(false);

  const capParsed = parseCap(cap);
  const capInvalid = capParsed === undefined;
  const canSave = title.trim().length > 0 && !capInvalid && !busy;

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        description,
        procedure: procedure.trim() === '' ? null : procedure,
        maxIterations: capParsed ?? null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Edit mission"
      onClose={onClose}
      footer={
        <>
          <button className={cancelBtnCls} onClick={onClose}>Cancel</button>
          <button className={primaryBtnCls} disabled={!canSave} onClick={save} data-testid="mission-edit-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>Goal</label>
        <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="mission-edit-title" />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea className={fieldCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Procedure <span className="text-gray-400">(the each-iteration recipe)</span></label>
        <textarea className={fieldCls} rows={4} value={procedure} onChange={(e) => setProcedure(e.target.value)} data-testid="mission-edit-procedure" />
      </div>
      <div>
        <label className={labelCls}>Max iterations <span className="text-gray-400">(STOP-WHEN cap — blank = no cap)</span></label>
        <input className={fieldCls} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="e.g. 8" data-testid="mission-edit-cap" />
        {capInvalid && <p className="text-3xs text-danger-500 mt-1">Enter a positive whole number, or leave blank for no cap.</p>}
      </div>
    </ModalShell>
  );
};

// ── Create dialog ─────────────────────────────────────────────────────────────

export const MissionCreateDialog: React.FC<{
  defaultSession?: string;
  onClose: () => void;
  onCreate: (body: { session: string; title: string; description?: string; criteria?: string[]; maxIterations?: number | null; procedure?: string | null }) => Promise<void>;
}> = ({ defaultSession, onClose, onCreate }) => {
  const [session, setSession] = useState(defaultSession ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [procedure, setProcedure] = useState('');
  const [cap, setCap] = useState('8');
  const [criteriaText, setCriteriaText] = useState('');
  const [busy, setBusy] = useState(false);

  const capParsed = parseCap(cap);
  const capInvalid = capParsed === undefined;
  const canCreate = title.trim().length > 0 && session.trim().length > 0 && !capInvalid && !busy;

  const create = async () => {
    setBusy(true);
    try {
      const criteria = criteriaText.split('\n').map((s) => s.trim()).filter(Boolean);
      await onCreate({
        session: session.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        procedure: procedure.trim() || undefined,
        maxIterations: capParsed ?? null,
        criteria: criteria.length ? criteria : undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="New mission"
      onClose={onClose}
      footer={
        <>
          <button className={cancelBtnCls} onClick={onClose}>Cancel</button>
          <button className={primaryBtnCls} disabled={!canCreate} onClick={create} data-testid="mission-create-save">
            {busy ? 'Creating…' : 'Create mission'}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>Owning session <span className="text-gray-400">(the session that drives the loop)</span></label>
        <input className={fieldCls} value={session} onChange={(e) => setSession(e.target.value)} placeholder="e.g. design" data-testid="mission-create-session" />
      </div>
      <div>
        <label className={labelCls}>Goal</label>
        <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="mission-create-title" />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea className={fieldCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Procedure <span className="text-gray-400">(each-iteration recipe)</span></label>
        <textarea className={fieldCls} rows={3} value={procedure} onChange={(e) => setProcedure(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Acceptance criteria <span className="text-gray-400">(one per line — the VERIFY gate)</span></label>
        <textarea className={fieldCls} rows={4} value={criteriaText} onChange={(e) => setCriteriaText(e.target.value)} placeholder="One criterion per line" data-testid="mission-create-criteria" />
      </div>
      <div>
        <label className={labelCls}>Max iterations <span className="text-gray-400">(blank = no cap)</span></label>
        <input className={fieldCls} value={cap} onChange={(e) => setCap(e.target.value)} data-testid="mission-create-cap" />
        {capInvalid && <p className="text-3xs text-danger-500 mt-1">Enter a positive whole number, or leave blank for no cap.</p>}
      </div>
    </ModalShell>
  );
};

// ── Gauge ─────────────────────────────────────────────────────────────────────

/** Expandable labelled progress bar (met/total). `tone` picks the fill family.
 *  Clicking the header row toggles `children` (the underlying item list). */
export const Gauge: React.FC<{
  label: string;
  met: number;
  total: number;
  tone: 'goal' | 'build';
  secondary?: boolean;
  headerTitle?: string;
  countTitle?: string;
  open: boolean;
  onToggle: () => void;
  testid?: string;
  children: React.ReactNode;
}> = ({ label, met, total, tone, secondary, headerTitle, countTitle, open, onToggle, testid, children }) => {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  const fill = tone === 'goal' ? 'bg-success-500' : 'bg-info-500';
  const barH = secondary ? 'h-1' : 'h-1.5';
  return (
    <div className={secondary ? 'min-w-[5rem]' : 'min-w-[6rem]'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={testid}
        className="group w-full text-left"
        title={headerTitle}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className={`flex items-center gap-0.5 text-3xs uppercase tracking-wide ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
            <span className="inline-block w-2 text-gray-400 dark:text-gray-500">{open ? '▾' : '▸'}</span>
            {label}
          </span>
          <span
            className={`text-2xs font-mono tabular-nums ${secondary ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}
            title={countTitle}
          >
            {met}/{total}
          </span>
        </div>
        <div className={`mt-0.5 ${barH} w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800`}>
          <div className={`${barH} ${fill} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </button>
      {open && (
        <div className="mt-1 pl-2.5 flex flex-col gap-0.5">
          {children}
        </div>
      )}
    </div>
  );
};

// ── Criteria editor (add / edit-text / remove — verdict stays read-only) ──────

export const CriteriaEditor: React.FC<{
  criteria: Array<{ id: string; text: string; met: boolean; order: number; verifiedAt?: number | null; verifiedAtSha?: string | null; evidencePaths?: string[] }>;
  onAdd: (text: string) => Promise<void>;
  onEdit: (criterionId: string, text: string) => Promise<void>;
  onRemove: (criterionId: string) => Promise<void>;
}> = ({ criteria, onAdd, onEdit, onRemove }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [addText, setAddText] = useState('');
  const [busy, setBusy] = useState(false);

  const sorted = criteria.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const commitEdit = async (id: string) => {
    if (!editText.trim()) { setEditingId(null); return; }
    setBusy(true);
    try { await onEdit(id, editText.trim()); setEditingId(null); } finally { setBusy(false); }
  };
  const commitAdd = async () => {
    if (!addText.trim()) return;
    setBusy(true);
    try { await onAdd(addText.trim()); setAddText(''); } finally { setBusy(false); }
  };

  return (
    <>
      {sorted.length === 0 && <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>}
      {sorted.map((c) => (
        <div key={c.id} className="py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
          <div className="flex items-start gap-1.5 text-sm leading-relaxed group/crit" data-testid="criterion-row">
            <span className={c.met ? 'text-success-600 dark:text-success-400' : 'text-gray-400 dark:text-gray-500'} title={c.met ? 'Met (verdict set by the independent verifier)' : 'Not yet met'} data-testid="criterion-marker">
              {c.met ? '✓' : '○'}
            </span>
            {editingId === c.id ? (
              <input
                autoFocus
                className="flex-1 rounded border border-info-300 dark:border-info-700 bg-white dark:bg-gray-900 px-1 py-0.5 text-3xs"
                value={editText}
                disabled={busy}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void commitEdit(c.id); if (e.key === 'Escape') setEditingId(null); }}
                onBlur={() => void commitEdit(c.id)}
                data-testid="criterion-edit-input"
              />
            ) : (
              <div className="flex-1 flex items-center gap-1">
                <span className={`leading-relaxed ${c.met ? 'text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}>
                  {c.text}
                </span>
                {c.met && c.verifiedAtSha && (
                  <span
                    data-testid="criterion-provenance"
                    className="text-3xs text-gray-400 dark:text-gray-500 font-mono"
                    title={`Independently checked at ${c.verifiedAtSha}; files uncited since.`}
                  >
                    @{c.verifiedAtSha.slice(0, 7)}
                  </span>
                )}
                {c.met && !c.verifiedAtSha && (
                  <span
                    data-testid="criterion-provenance"
                    className="text-3xs text-gray-400 dark:text-gray-500 italic"
                    title="Marked met without an independent verify — provenance unknown."
                  >
                    (unverified)
                  </span>
                )}
              </div>
            )}
            {editingId !== c.id && (
              <span className="opacity-0 group-hover/crit:opacity-100 flex gap-0.5 shrink-0">
                <button
                  type="button"
                  title="Edit assertion text (clears the verdict — re-verify)"
                  className="text-gray-400 hover:text-info-600"
                  onClick={() => { setEditingId(c.id); setEditText(c.text); }}
                  data-testid="criterion-edit-btn"
                >✎</button>
                <button
                  type="button"
                  title="Remove criterion"
                  className="text-gray-400 hover:text-danger-600"
                  disabled={busy}
                  onClick={() => void onRemove(c.id)}
                  data-testid="criterion-remove-btn"
                >✕</button>
              </span>
            )}
          </div>
          {editingId !== c.id && c.evidencePaths?.length ? (
            <div data-testid="criterion-evidence" className="ml-5 mt-0.5 text-3xs text-gray-400 dark:text-gray-500 font-mono leading-snug">
              {c.evidencePaths.map((path, idx) => (
                <div key={idx} className="truncate" title={path}>
                  {path}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div className="flex items-center gap-1 mt-0.5">
        <input
          className="flex-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-1 py-0.5 text-3xs"
          value={addText}
          disabled={busy}
          placeholder="+ add criterion"
          onChange={(e) => setAddText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void commitAdd(); }}
          data-testid="criterion-add-input"
        />
        <button
          type="button"
          className="text-3xs px-1 rounded text-info-600 disabled:opacity-40"
          disabled={busy || !addText.trim()}
          onClick={() => void commitAdd()}
          data-testid="criterion-add-btn"
        >add</button>
      </div>
    </>
  );
};

// ── Mission detail components ─────────────────────────────────────────────────

/** MissionTabs — a tab bar primitive. */
export const MissionTabs: React.FC<{
  tabs: Array<{ key: string; label: string; testid?: string }>;
  active: string;
  onChange: (key: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div role="tablist" data-testid="mission-detail-tabs" className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-2">
    {tabs.map((tab) => (
      <button
        key={tab.key}
        role="tab"
        aria-selected={active === tab.key}
        data-testid={tab.testid}
        onClick={() => onChange(tab.key)}
        className={`px-2 py-1 text-3xs font-medium border-b-2 transition-colors ${
          active === tab.key
            ? 'border-info-500 text-info-700 dark:text-info-300'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

/** EpicList — renders the epics from a mission. */
export const EpicList: React.FC<{ epics: MissionView['epics'] }> = ({ epics }) => (
  <div data-testid="mission-epic-list" className="flex flex-col gap-0.5">
    {epics.length === 0 ? (
      <span className="text-3xs text-gray-400 dark:text-gray-500 italic">No epics yet for this mission</span>
    ) : (
      epics.map((e) => (
        <div key={e.id} className="flex items-start gap-1 text-sm leading-relaxed py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0" title={`${e.status}${e.acceptanceStatus ? ` · ${e.acceptanceStatus}` : ''}`}>
          <span className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${epicDotClass(e.status)}`} aria-hidden />
          <span className="text-gray-900 dark:text-gray-100 truncate">
            {stripKindPrefix(e.title)}
          </span>
          <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 lowercase">
            {e.status}
          </span>
        </div>
      ))
    )}
  </div>
);

/** MissionDetail — the descriptive detail view for a selected mission. */
export const MissionDetail: React.FC<{
  m: MissionSummary;
  serverId: string;
  project: string;
  activeTab: 'goal' | 'build';
  onTabChange: (key: 'goal' | 'build') => void;
  onChanged: (next: MissionSummary[]) => void;
  onDropped?: () => void;
}> = ({ m, serverId, project, activeTab, onTabChange, onChanged, onDropped }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const activateMission = useSupervisorStore((s) => s.activateMission);
  const approveMission = useSupervisorStore((s) => s.approveMission);
  const abandonMission = useSupervisorStore((s) => s.abandonMission);
  const updateMission = useSupervisorStore((s) => s.updateMission);
  const deleteMission = useSupervisorStore((s) => s.deleteMission);
  const addMissionCriterion = useSupervisorStore((s) => s.addMissionCriterion);
  const updateMissionCriterion = useSupervisorStore((s) => s.updateMissionCriterion);
  const removeMissionCriterion = useSupervisorStore((s) => s.removeMissionCriterion);
  const fetchConductorTarget = useSupervisorStore((s) => s.fetchConductorTarget);
  const setConductorTarget = useSupervisorStore((s) => s.setConductorTarget);
  const [pinnedTarget, setPinnedTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConductorTarget(serverId, project).then((t) => { if (!cancelled) setPinnedTarget(t); });
    return () => { cancelled = true; };
  }, [serverId, project, fetchConductorTarget]);

  const view = missionView(m);

  const isPinned = !!view.missionId && pinnedTarget === view.missionId;

  const run = async (fn: () => Promise<MissionSummary[]>) => {
    setBusy(true);
    try { onChanged(await fn()); } finally { setBusy(false); }
  };

  const doActivate = () => {
    if (!view.missionId) return;
    if (isTerminalPhase(view.phase)) { setConfirmActivate(true); return; }
    void run(() => activateMission(serverId, project, view.missionId!));
  };

  const doApprove = () => {
    if (!view.missionId) return;
    void run(() => approveMission(serverId, project, view.missionId!));
  };

  const doPinToggle = () => {
    if (!view.missionId) return;
    void setConductorTarget(serverId, project, isPinned ? null : view.missionId!).then(setPinnedTarget);
  };

  return (
    <div data-testid="mission-detail" className="flex flex-col gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
      {/* Header block */}
      <div data-testid="mission-detail-header" className="flex flex-col gap-2">
        {/* Name + status row */}
        <div className="flex items-start justify-between gap-2">
          <span
            className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug flex-1"
            title={m.node?.title}
          >
            {stripKindPrefix(m.node?.title ?? 'Mission')}
          </span>
          <StatusPill status={view.status} />
        </div>

        {/* Session/owner line */}
        {view.owner && (
          <div
            className="flex items-center gap-1 text-3xs text-gray-400 dark:text-gray-500"
            title="The session that owns / drives this mission."
          >
            <span aria-hidden>◷</span>
            <span className="font-mono truncate">session: {view.owner}</span>
          </div>
        )}

        {/* Controls cluster */}
        <div className="flex items-center gap-1">
          {view.status === 'unapproved' && (
            <MiniButton onClick={doApprove} disabled={busy} tone="primary" title="Approve this mission — activates it and ratifies its proposed constraints" testid="mission-approve-btn">
              Approve
            </MiniButton>
          )}
          {!view.active && (
            <MiniButton onClick={doActivate} disabled={busy} tone="primary" title="Make this the active mission (pauses the session's other missions)" testid="mission-activate-btn">
              Activate
            </MiniButton>
          )}
          {view.active && (
            <span className="text-3xs text-success-600 dark:text-success-400 px-1" title="This is the active mission for its session.">● active</span>
          )}
          <MiniButton
            onClick={doPinToggle}
            disabled={busy}
            tone={isPinned ? 'primary' : 'default'}
            title={isPinned ? 'Unpin — the conductor picks its own target mission again' : 'Pin — make the conductor drive exactly this mission'}
            testid="mission-pin-conductor-btn"
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </MiniButton>
          <MiniButton onClick={() => setConfirmDelete(true)} disabled={busy} tone="danger" title="Drop this mission (soft-abandon — kept as a record, removed from the active view)" testid="mission-drop-btn">
            Drop
          </MiniButton>
          <MiniButton onClick={() => setEditing(true)} disabled={busy} title="Edit goal / description / procedure / cap" testid="mission-edit-btn">
            Edit
          </MiniButton>
          <MiniButton onClick={() => setConfirmHardDelete(true)} disabled={busy} tone="danger" title="Delete this mission (irreversible)" testid="mission-delete-btn">
            Delete
          </MiniButton>
        </div>
      </div>

      {/* Tab bar */}
      <MissionTabs
        tabs={[
          { key: 'goal', label: 'Goal', testid: 'mission-tab-goal' },
          { key: 'build', label: 'Build', testid: 'mission-tab-build' },
        ]}
        active={activeTab}
        onChange={(key) => onTabChange(key as 'goal' | 'build')}
      />

      {view.stopped && !view.converged && (
        <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
          <span
            data-testid="mission-stopped"
            className="text-gray-500 dark:text-gray-400 font-semibold"
            title={`Loop stopped: ${view.stopReason ?? 'reached a terminal state'}.`}
          >
            stopped{view.stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        </div>
      )}

      {view.procedure && (
        <div
          className="text-3xs text-gray-500 dark:text-gray-400 leading-snug border-l-2 border-gray-200 dark:border-gray-700 pl-1.5"
          title={`Each iteration:\n${view.procedure}`}
        >
          <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">each iter:</span> {view.procedure}
        </div>
      )}

      {/* Goal tab body */}
      {activeTab === 'goal' && (
        <div data-testid="mission-goals-tab">
          <div className="text-3xs text-gray-500 dark:text-gray-400 mb-2">
            <span className="font-mono">{view.cap.met}/{view.cap.total}</span> acceptance criteria met
          </div>
          <CriteriaEditor
            criteria={view.criteria}
            onAdd={(text) => run(() => addMissionCriterion(serverId, project, view.missionId!, text))}
            onEdit={(id, text) => run(() => updateMissionCriterion(serverId, project, id, text))}
            onRemove={(id) => run(() => removeMissionCriterion(serverId, project, id))}
          />
        </div>
      )}

      {/* Build tab body */}
      {activeTab === 'build' && (
        <div data-testid="mission-build-tab">
          <div className="text-3xs text-gray-500 dark:text-gray-400 mb-2">
            <span className="font-mono">{view.mech.done}/{view.mech.total}</span> epics done (mechanical) · <span className="font-mono">{view.cap.met}/{view.cap.total}</span> capability met
          </div>
          <EpicList epics={view.epics} />
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Drop mission?"
        message={<>Drop <strong>{stripKindPrefix(m.node?.title ?? 'this mission')}</strong>? It is soft-abandoned — the record and its criteria are kept but it leaves the active view. You can re-activate it later.</>}
        confirmLabel="Drop"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); void run(() => abandonMission(serverId, project, view.missionId!, Date.now())).then(() => onDropped?.()); }}
      />

      <ConfirmDialog
        isOpen={confirmActivate}
        title="Re-activate a completed mission?"
        message={<>This mission has already <strong>{view.phase}</strong>. Re-activating it makes it the session's active mission, but the loop won't re-drive a terminal mission. Continue?</>}
        confirmLabel="Activate anyway"
        onCancel={() => setConfirmActivate(false)}
        onConfirm={() => { setConfirmActivate(false); void run(() => activateMission(serverId, project, view.missionId!)); }}
      />

      {editing && (
        <MissionEditDialog
          m={m}
          onClose={() => setEditing(false)}
          onSave={(patch) => run(() => updateMission(serverId, project, view.missionId!, patch))}
        />
      )}

      <ConfirmDialog
        isOpen={confirmHardDelete}
        title="Delete mission?"
        message={<>Permanently delete <strong>{stripKindPrefix(m.node?.title ?? 'this mission')}</strong>? This drops the mission node, its loop state, and all criteria. This cannot be undone.</>}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmHardDelete(false)}
        onConfirm={() => { setConfirmHardDelete(false); void run(() => deleteMission(serverId, project, view.missionId!)).then(() => onDropped?.()); }}
      />
    </div>
  );
};

// ── Mission card ──────────────────────────────────────────────────────────────

/** Computed view of a MissionSummary — derived fields for rendering. */
export interface MissionView {
  phase: MissionPhase;
  status: MissionStatus;
  iteration: number;
  maxIterations: number | null;
  converged: boolean;
  stopped: boolean;
  stopReason: string | null;
  procedure: string | null;
  cap: { met: number; total: number };
  mech: { done: number; total: number };
  criteria: Array<{ id: string; text: string; met: boolean; order: number; verifiedAt?: number | null; verifiedAtSha?: string | null; evidencePaths?: string[] }>;
  epics: Array<{ id: string; title: string; status: string; acceptanceStatus?: string }>;
  owner: string | null;
  active: boolean;
  missionId: string | undefined;
}

/** Helper to compute the derived fields a MissionCard needs. */
export function missionView(m: MissionSummary): MissionView {
  const phase = (m.rollup?.phase ?? m.mission?.phase ?? 'discover') as MissionPhase;
  const status = (m.rollup?.status ?? 'needs-discovery') as MissionStatus;
  const iteration = m.rollup?.iteration ?? m.mission?.iteration ?? 0;
  const maxIterations = m.rollup?.maxIterations ?? m.mission?.maxIterations ?? null;
  const converged = !!m.rollup?.converged;
  const stopped = phase === 'stopped';
  const stopReason = m.rollup?.stopReason ?? m.mission?.stopReason ?? null;
  const procedure = m.mission?.procedure ?? null;
  const cap = m.rollup?.capability ?? { met: 0, total: 0 };
  const mech = m.rollup?.mechanical ?? { done: 0, total: 0 };
  const criteria = m.criteria ?? [];
  const epics = m.epics ?? [];
  const owner = m.ownerSession ?? m.assigneeSession ?? null;
  const active = m.mission?.active !== false;
  const missionId = m.node?.id;

  return { phase, status, iteration, maxIterations, converged, stopped, stopReason, procedure, cap, mech, criteria, epics, owner, active, missionId };
}

export const MissionCard: React.FC<{
  m: MissionSummary;
  serverId: string;
  project: string;
  onChanged: (next: MissionSummary[]) => void;
}> = ({ m, serverId, project, onChanged }) => {
  const [goalOpen, setGoalOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const activateMission = useSupervisorStore((s) => s.activateMission);
  const updateMission = useSupervisorStore((s) => s.updateMission);
  const deleteMission = useSupervisorStore((s) => s.deleteMission);
  const addMissionCriterion = useSupervisorStore((s) => s.addMissionCriterion);
  const updateMissionCriterion = useSupervisorStore((s) => s.updateMissionCriterion);
  const removeMissionCriterion = useSupervisorStore((s) => s.removeMissionCriterion);
  const fetchConductorTarget = useSupervisorStore((s) => s.fetchConductorTarget);
  const setConductorTarget = useSupervisorStore((s) => s.setConductorTarget);
  const [pinnedTarget, setPinnedTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConductorTarget(serverId, project).then((t) => { if (!cancelled) setPinnedTarget(t); });
    return () => { cancelled = true; };
  }, [serverId, project, fetchConductorTarget]);

  const view = missionView(m);

  const isPinned = !!view.missionId && pinnedTarget === view.missionId;

  const run = async (fn: () => Promise<MissionSummary[]>) => {
    setBusy(true);
    try { onChanged(await fn()); } finally { setBusy(false); }
  };

  const doActivate = () => {
    if (!view.missionId) return;
    if (isTerminalPhase(view.phase)) { setConfirmActivate(true); return; }
    void run(() => activateMission(serverId, project, view.missionId!));
  };

  const doPinToggle = () => {
    if (!view.missionId) return;
    void setConductorTarget(serverId, project, isPinned ? null : view.missionId!).then(setPinnedTarget);
  };

  return (
    <div
      data-testid="mission-card"
      data-active={view.active}
      className={`shrink-0 w-72 rounded-lg border px-3 py-2 flex flex-col gap-2 ${
        view.active
          ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60'
          : 'border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 opacity-60'
      }`}
      title={view.active ? undefined : 'Paused — not the active mission for this session (the loop drives one at a time).'}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 flex items-center gap-1"
          title={m.node?.title}
        >
          {!view.active && (
            <span className="shrink-0 text-3xs font-normal not-italic text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-gray-600 rounded px-1" title="Paused">
              paused
            </span>
          )}
          {stripKindPrefix(m.node?.title ?? 'Mission')}
        </span>
        <StatusPill status={view.status} />
      </div>

      {view.owner && (
        <div
          className="flex items-center gap-1 text-3xs text-gray-400 dark:text-gray-500"
          title="The session that owns / drives this mission."
        >
          <span aria-hidden>◷</span>
          <span className="font-mono truncate">session: {view.owner}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
        <span
          className="font-mono"
          title={
            view.maxIterations != null
              ? `Iteration ${view.iteration} of a max ${view.maxIterations} (STOP-WHEN cap).`
              : `Iteration ${view.iteration} — laps around the loop (no cap set).`
          }
        >
          iter {view.iteration}{view.maxIterations != null ? `/${view.maxIterations}` : ''}
        </span>
        {view.converged && (
          <span
            data-testid="mission-converged"
            className="text-success-600 dark:text-success-400 font-semibold"
            title="All criteria met — goal achieved (VERIFY passed)."
          >
            converged ✓
          </span>
        )}
        {view.stopped && !view.converged && (
          <span
            data-testid="mission-stopped"
            className="text-gray-500 dark:text-gray-400 font-semibold"
            title={`Loop stopped: ${view.stopReason ?? 'reached a terminal state'}.`}
          >
            stopped{view.stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        )}
      </div>

      {view.procedure && (
        <div
          className="text-3xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2 border-l-2 border-gray-200 dark:border-gray-700 pl-1.5"
          title={`Each iteration:\n${view.procedure}`}
        >
          <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">each iter:</span> {view.procedure}
        </div>
      )}

      <Gauge
        label="Goal"
        met={view.cap.met}
        total={view.cap.total}
        tone="goal"
        headerTitle="Acceptance criteria met — the real 'is the goal achieved' gauge. Click to see / edit the criteria."
        countTitle="Acceptance criteria met / total."
        open={goalOpen}
        onToggle={() => setGoalOpen((v) => !v)}
        testid="mission-goal-toggle"
      >
        <CriteriaEditor
          criteria={view.criteria}
          onAdd={(text) => run(() => addMissionCriterion(serverId, project, view.missionId!, text))}
          onEdit={(id, text) => run(() => updateMissionCriterion(serverId, project, id, text))}
          onRemove={(id) => run(() => removeMissionCriterion(serverId, project, id))}
        />
      </Gauge>

      <Gauge
        label="Build"
        met={view.mech.done}
        total={view.mech.total}
        tone="build"
        secondary
        headerTitle="This iteration's epics done / total (the current build work). Click to see the epics."
        countTitle="Epics done / total this iteration."
        open={buildOpen}
        onToggle={() => setBuildOpen((v) => !v)}
        testid="mission-build-toggle"
      >
        {view.epics.length === 0 ? (
          <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>
        ) : (
          view.epics.map((e) => (
            <div key={e.id} className="flex items-start gap-1 text-3xs leading-snug" title={`${e.status}${e.acceptanceStatus ? ` · ${e.acceptanceStatus}` : ''}`}>
              <span className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${epicDotClass(e.status)}`} aria-hidden />
              <span className="text-gray-600 dark:text-gray-300 truncate">
                {stripKindPrefix(e.title)}
              </span>
              <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 lowercase">
                {e.status}
              </span>
            </div>
          ))
        )}
      </Gauge>

      {/* Authoring action row */}
      <div className="flex items-center gap-1 pt-1 border-t border-gray-100 dark:border-gray-700/60">
        {!view.active && (
          <MiniButton onClick={doActivate} disabled={busy} tone="primary" title="Make this the active mission (pauses the session's other missions)" testid="mission-activate-btn">
            Activate
          </MiniButton>
        )}
        {view.active && (
          <span className="text-3xs text-success-600 dark:text-success-400 px-1" title="This is the active mission for its session.">● active</span>
        )}
        <MiniButton
          onClick={doPinToggle}
          disabled={busy}
          tone={isPinned ? 'primary' : 'default'}
          title={isPinned ? 'Unpin — the conductor picks its own target mission again' : 'Pin — make the conductor drive exactly this mission'}
          testid="mission-pin-conductor-btn"
        >
          {isPinned ? 'Unpin' : 'Pin'}
        </MiniButton>
        <MiniButton onClick={() => setEditing(true)} disabled={busy} title="Edit goal / description / procedure / cap" testid="mission-edit-btn">
          Edit
        </MiniButton>
        <MiniButton onClick={() => setConfirmDelete(true)} disabled={busy} tone="danger" title="Delete this mission (irreversible)" testid="mission-delete-btn">
          Delete
        </MiniButton>
      </div>

      {editing && (
        <MissionEditDialog
          m={m}
          onClose={() => setEditing(false)}
          onSave={(patch) => run(() => updateMission(serverId, project, view.missionId!, patch))}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete mission?"
        message={<>Permanently delete <strong>{stripKindPrefix(m.node?.title ?? 'this mission')}</strong>? This drops the mission node, its loop state, and all criteria. This cannot be undone.</>}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); void run(() => deleteMission(serverId, project, view.missionId!)); }}
      />

      <ConfirmDialog
        isOpen={confirmActivate}
        title="Re-activate a completed mission?"
        message={<>This mission has already <strong>{view.phase}</strong>. Re-activating it makes it the session's active mission, but the loop won't re-drive a terminal mission. Continue?</>}
        confirmLabel="Activate anyway"
        onCancel={() => setConfirmActivate(false)}
        onConfirm={() => { setConfirmActivate(false); void run(() => activateMission(serverId, project, view.missionId!)); }}
      />
    </div>
  );
};

/** A mission is "completed" (hidden unless Show completed) once it reaches a terminal
 *  phase — converged (goal met) or stopped (STOP-WHEN cap hit). */
export function isMissionCompleted(m: MissionSummary): boolean {
  const phase = m.rollup?.phase ?? m.mission?.phase;
  return !!m.rollup?.stopped || phase === 'converged' || phase === 'stopped' || m.rollup?.status === 'abandoned';
}
