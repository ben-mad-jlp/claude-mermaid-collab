/**
 * MissionsStrip — surfaces convergence-loop MISSIONS distinctly at the TOP of the
 * Plan board. A [MISSION] node is otherwise invisible (just another work-graph
 * todo on the board); this strip renders one card per mission with its PHASE, the
 * GOAL gauge (acceptance criteria met/total — the real convergence gauge), and a
 * secondary BUILD gauge (this iteration's [EPIC] children done/total). Each gauge
 * row EXPANDS to list its underlying items (criteria / epics).
 *
 * AUTHORING (write) surface — the strip lets a human curate WHAT a mission is:
 *   • switch the active mission (activate)      • edit goal / description / procedure / cap
 *   • add / edit-text / remove criteria         • create a new mission          • delete
 * DELIBERATELY steward/MCP-only (NOT here): setting a criterion's met/unmet VERDICT
 * (independent VERIFY, maker≠checker) and advancing the PHASE (the autonomous loop
 * owns phase). Mutations RE-FETCH (no optimistic update — can't race the 15s poll).
 *
 * Data comes from GET /api/supervisor/missions via supervisorStore.fetchMissions
 * (fail-open → []). Renders NOTHING when there are zero missions AND no session to
 * create one under. Refetches on mount + project/session change; polls on cadence.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore, type MissionSummary, type MissionPhase } from '@/stores/supervisorStore';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export interface MissionsStripProps {
  serverId: string;
  project: string;
  /** Optional: the live session, used as the default owner when creating a mission. */
  session?: string;
}

/** Phase → pill classes. 'converged' is loud green; the rest reuse the board's
 *  neutral/info/violet/amber token families so the strip reads as one system. */
const PHASE_STYLE: Record<MissionPhase, string> = {
  discover:  'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  plan:      'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  execute:   'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  verify:    'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  converged: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  stopped:   'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const PHASE_LABEL: Record<MissionPhase, string> = {
  discover: 'Discover',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  converged: 'Converged',
  stopped: 'Stopped',
};

/** The canonical agentic loop, in order — used to build the phase tooltip. */
const PHASE_CYCLE: MissionPhase[] = ['discover', 'plan', 'execute', 'verify'];

function phaseTooltip(phase: MissionPhase): string {
  const cycle = PHASE_CYCLE.map((p) => PHASE_LABEL[p]).join(' → ');
  const current = PHASE_LABEL[phase] ?? phase;
  return `Convergence loop: ${cycle} → (iterate: loop back).\nVerify decides: converged / stopped / loop again.\nCurrent phase: ${current}.`;
}

function stripMissionPrefix(title: string): string {
  return title.replace(/^\[MISSION\]\s*/i, '');
}

function stripEpicPrefix(title: string): string {
  return title.replace(/^\[EPIC\]\s*/i, '');
}

const isTerminalPhase = (p: MissionPhase): boolean => p === 'converged' || p === 'stopped';

/** Board-ish status → dot colour for an epic row. */
function epicDotClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'accepted') return 'bg-success-500';
  if (s === 'blocked' || s === 'rejected' || s === 'failed') return 'bg-warning-500';
  if (s === 'in_progress' || s === 'building' || s === 'active') return 'bg-info-500';
  return 'bg-gray-300 dark:bg-gray-600';
}

// ── small shared UI primitives ───────────────────────────────────────────────

/** A tiny text-button used for the card action row. */
const MiniButton: React.FC<{
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
const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({
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

const fieldCls =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-info-500 outline-none';
const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-300 mb-1 block';
const primaryBtnCls =
  'px-4 py-2 text-sm font-medium rounded-lg bg-info-600 text-white hover:bg-info-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const cancelBtnCls =
  'px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors';

/** Parse a maxIterations input: '' → null (no cap); a positive int → that; else undefined (invalid, ignored). */
function parseCap(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// ── Edit dialog (goal / description / procedure / cap) ────────────────────────

const MissionEditDialog: React.FC<{
  m: MissionSummary;
  onClose: () => void;
  onSave: (patch: { title?: string; description?: string; maxIterations?: number | null; procedure?: string | null }) => Promise<void>;
}> = ({ m, onClose, onSave }) => {
  const [title, setTitle] = useState(stripMissionPrefix(m.node?.title ?? ''));
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
        <label className={labelCls}>Goal <span className="text-gray-400">([MISSION] prefix kept automatically)</span></label>
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

const MissionCreateDialog: React.FC<{
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
        <label className={labelCls}>Goal <span className="text-gray-400">([MISSION] prefix added automatically)</span></label>
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
const Gauge: React.FC<{
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

const CriteriaEditor: React.FC<{
  criteria: Array<{ id: string; text: string; met: boolean; order: number }>;
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
        <div key={c.id} className="flex items-start gap-1 text-3xs leading-snug group/crit" data-testid="criterion-row">
          <span className={c.met ? 'text-success-600 dark:text-success-400' : 'text-gray-400 dark:text-gray-500'} title={c.met ? 'Met (verdict set by the independent verifier)' : 'Not yet met'}>
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
            <span className={`flex-1 ${c.met ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>
              {c.text}
            </span>
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

// ── Mission card ──────────────────────────────────────────────────────────────

const MissionCard: React.FC<{
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

  const phase = (m.rollup?.phase ?? m.mission?.phase ?? 'discover') as MissionPhase;
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
  const active = m.mission?.active !== false; // default active
  const missionId = m.node?.id;

  const run = async (fn: () => Promise<MissionSummary[]>) => {
    setBusy(true);
    try { onChanged(await fn()); } finally { setBusy(false); }
  };

  const doActivate = () => {
    if (!missionId) return;
    // Terminal missions are already done — re-activating won't re-drive the loop; confirm.
    if (isTerminalPhase(phase)) { setConfirmActivate(true); return; }
    void run(() => activateMission(serverId, project, missionId));
  };

  return (
    <div
      data-testid="mission-card"
      data-active={active}
      className={`shrink-0 w-72 rounded-lg border px-3 py-2 flex flex-col gap-2 ${
        active
          ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60'
          : 'border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 opacity-60'
      }`}
      title={active ? undefined : 'Paused — not the active mission for this session (the loop drives one at a time).'}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 flex items-center gap-1"
          title={m.node?.title}
        >
          {!active && (
            <span className="shrink-0 text-3xs font-normal not-italic text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-gray-600 rounded px-1" title="Paused">
              paused
            </span>
          )}
          {stripMissionPrefix(m.node?.title ?? 'Mission')}
        </span>
        <span
          className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${PHASE_STYLE[phase] ?? PHASE_STYLE.discover}`}
          title={phaseTooltip(phase)}
        >
          Phase: {PHASE_LABEL[phase] ?? phase}
        </span>
      </div>

      {owner && (
        <div
          className="flex items-center gap-1 text-3xs text-gray-400 dark:text-gray-500"
          title="The session that owns / drives this mission."
        >
          <span aria-hidden>◷</span>
          <span className="font-mono truncate">session: {owner}</span>
        </div>
      )}

      <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
        <span
          className="font-mono"
          title={
            maxIterations != null
              ? `Iteration ${iteration} of a max ${maxIterations} (STOP-WHEN cap).`
              : `Iteration ${iteration} — laps around the loop (no cap set).`
          }
        >
          iter {iteration}{maxIterations != null ? `/${maxIterations}` : ''}
        </span>
        {converged && (
          <span
            data-testid="mission-converged"
            className="text-success-600 dark:text-success-400 font-semibold"
            title="All criteria met — goal achieved (VERIFY passed)."
          >
            converged ✓
          </span>
        )}
        {stopped && !converged && (
          <span
            data-testid="mission-stopped"
            className="text-gray-500 dark:text-gray-400 font-semibold"
            title={`Loop stopped: ${stopReason ?? 'reached a terminal state'}.`}
          >
            stopped{stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        )}
      </div>

      {procedure && (
        <div
          className="text-3xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2 border-l-2 border-gray-200 dark:border-gray-700 pl-1.5"
          title={`Each iteration:\n${procedure}`}
        >
          <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">each iter:</span> {procedure}
        </div>
      )}

      <Gauge
        label="Goal"
        met={cap.met}
        total={cap.total}
        tone="goal"
        headerTitle="Acceptance criteria met — the real 'is the goal achieved' gauge. Click to see / edit the criteria."
        countTitle="Acceptance criteria met / total."
        open={goalOpen}
        onToggle={() => setGoalOpen((v) => !v)}
        testid="mission-goal-toggle"
      >
        <CriteriaEditor
          criteria={criteria}
          onAdd={(text) => run(() => addMissionCriterion(serverId, project, missionId, text))}
          onEdit={(id, text) => run(() => updateMissionCriterion(serverId, project, id, text))}
          onRemove={(id) => run(() => removeMissionCriterion(serverId, project, id))}
        />
      </Gauge>

      <Gauge
        label="Build"
        met={mech.done}
        total={mech.total}
        tone="build"
        secondary
        headerTitle="This iteration's epics done / total (the current build work). Click to see the epics."
        countTitle="Epics done / total this iteration."
        open={buildOpen}
        onToggle={() => setBuildOpen((v) => !v)}
        testid="mission-build-toggle"
      >
        {epics.length === 0 ? (
          <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>
        ) : (
          epics.map((e) => (
            <div key={e.id} className="flex items-start gap-1 text-3xs leading-snug" title={`${e.status}${e.acceptanceStatus ? ` · ${e.acceptanceStatus}` : ''}`}>
              <span className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${epicDotClass(e.status)}`} aria-hidden />
              <span className="text-gray-600 dark:text-gray-300 truncate">
                {stripEpicPrefix(e.title)}
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
        {!active && (
          <MiniButton onClick={doActivate} disabled={busy} tone="primary" title="Make this the active mission (pauses the session's other missions)" testid="mission-activate-btn">
            Activate
          </MiniButton>
        )}
        {active && (
          <span className="text-3xs text-success-600 dark:text-success-400 px-1" title="This is the active mission for its session.">● active</span>
        )}
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
          onSave={(patch) => run(() => updateMission(serverId, project, missionId, patch))}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete mission?"
        message={<>Permanently delete <strong>{stripMissionPrefix(m.node?.title ?? 'this mission')}</strong>? This drops the mission node, its loop state, and all criteria. This cannot be undone.</>}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); void run(() => deleteMission(serverId, project, missionId)); }}
      />

      <ConfirmDialog
        isOpen={confirmActivate}
        title="Re-activate a completed mission?"
        message={<>This mission has already <strong>{phase}</strong>. Re-activating it makes it the session's active mission, but the loop won't re-drive a terminal mission. Continue?</>}
        confirmLabel="Activate anyway"
        onCancel={() => setConfirmActivate(false)}
        onConfirm={() => { setConfirmActivate(false); void run(() => activateMission(serverId, project, missionId)); }}
      />
    </div>
  );
};

/** A mission is "completed" (hidden unless Show completed) once it reaches a terminal
 *  phase — converged (goal met) or stopped (STOP-WHEN cap hit). */
function isMissionCompleted(m: MissionSummary): boolean {
  const phase = m.rollup?.phase ?? m.mission?.phase;
  return !!m.rollup?.stopped || phase === 'converged' || phase === 'stopped';
}

export const MissionsStrip: React.FC<MissionsStripProps> = ({ serverId, project, session }) => {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const createMission = useSupervisorStore((s) => s.createMission);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    // Show ALL of the PROJECT's missions on its board — NOT session-scoped. A mission
    // owns a session (shown on the card) but must stay visible on its project board
    // regardless of which session is active, else it looks like a plain [EPIC].
    const load = async () => {
      const next = await fetchMissions(serverId, project);
      if (alive) setMissions(next);
    };
    void load();
    // Poll on a modest cadence so phase/gauges track the loop without a WS event.
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, fetchMissions]);

  // Render nothing only when there are no missions AND nothing to create under —
  // but keep the header available so a human can author the first mission when a
  // session is known.
  if (missions.length === 0 && !session) return null;

  const completedCount = missions.filter(isMissionCompleted).length;
  const shown = showCompleted ? missions : missions.filter((m) => !isMissionCompleted(m));

  return (
    <div
      data-testid="missions-strip"
      className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
    >
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Missions
        </span>
        <span className="text-3xs text-gray-400 dark:text-gray-500">
          convergence loop
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="mission-new-btn"
          className="ml-1 text-3xs px-1.5 py-0.5 rounded border border-info-200 dark:border-info-800 text-info-700 dark:text-info-300 hover:bg-info-50 dark:hover:bg-info-900/30 transition-colors"
          title="Create a new convergence mission"
        >
          + New mission
        </button>
        {completedCount > 0 && (
          <label
            className="ml-auto flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 cursor-pointer select-none"
            title="Show missions that have converged or stopped."
          >
            <input
              type="checkbox"
              data-testid="missions-show-completed"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="h-3 w-3 rounded border-gray-300 dark:border-gray-600"
            />
            Show completed ({completedCount})
          </label>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto px-3 py-2 items-start">
        {missions.length === 0 ? (
          <span className="px-1 text-3xs italic text-gray-400 dark:text-gray-500">
            No missions yet — click “+ New mission” to start a convergence loop.
          </span>
        ) : shown.length === 0 ? (
          <span className="px-1 text-3xs italic text-gray-400 dark:text-gray-500">
            All {completedCount} mission{completedCount === 1 ? '' : 's'} completed — check “Show completed” to view.
          </span>
        ) : (
          shown.map((m) => (
            <MissionCard
              key={m.node?.id ?? m.mission?.todoId}
              m={m}
              serverId={serverId}
              project={project}
              onChanged={setMissions}
            />
          ))
        )}
      </div>

      {creating && (
        <MissionCreateDialog
          defaultSession={session}
          onClose={() => setCreating(false)}
          onCreate={async (body) => { setMissions(await createMission(serverId, project, body)); }}
        />
      )}
    </div>
  );
};

export default MissionsStrip;
