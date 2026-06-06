/**
 * SpecSheetPane — the Spec Sheet authoring artifact (design §4, P1).
 *
 * A two-column Studio pane (ArtifactTree kind:'spec', one per project): LEFT the
 * typed system-object tree, RIGHT the selected object's promise chips + a BOM
 * rollup, with an inline `+ promise` composer (press `n`) that proposes a
 * requirement into the Bridge RequirementsInbox for signature. The object tree is
 * a typed tree, NOT a FleetGraph node-kind (§5); coverage is answered inline off
 * the loadCoverage rollup, no second canvas.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSupervisorStore, type RequirementSpec } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { RequirementChip } from '@/components/supervisor/bridge/RequirementChip';
import { coverageStateOf, COVERAGE_TINTS } from './objectTreeModel';
import { SystemObjectTree } from './SystemObjectTree';

export interface SpecSheetPaneProps {
  project: string;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export const SpecSheetPane: React.FC<SpecSheetPaneProps> = ({ project }) => {
  const serverScope = useSessionStore((s) => s.currentSession?.serverId) ?? 'local';

  const objects = useSupervisorStore((s) => s.systemObjectsByProject[project]) ?? [];
  const coverage = useSupervisorStore((s) => s.coverageByProject[project]);
  const requirements = useSupervisorStore((s) => s.requirementsByProject[project]) ?? [];
  const bomByRoot = useSupervisorStore((s) => s.bomByRoot);
  const loadSystemObjects = useSupervisorStore((s) => s.loadSystemObjects);
  const loadCoverage = useSupervisorStore((s) => s.loadCoverage);
  const loadRequirements = useSupervisorStore((s) => s.loadRequirements);
  const loadBom = useSupervisorStore((s) => s.loadBom);
  const proposeRequirement = useSupervisorStore((s) => s.proposeRequirement);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!project) return;
    void loadSystemObjects(serverScope, project);
    void loadCoverage(serverScope, project);
    void loadRequirements(serverScope, project);
  }, [serverScope, project, loadSystemObjects, loadCoverage, loadRequirements]);

  useEffect(() => {
    if (selectedId) void loadBom(serverScope, project, selectedId);
  }, [serverScope, project, selectedId, loadBom]);

  // `n` opens the promise composer (design §7.2), unless typing in a field.
  const composingRef = useRef(composing);
  composingRef.current = composing;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (composingRef.current) return;
      if (ev.key === 'n' || ev.key === 'N') {
        ev.preventDefault();
        setComposing(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selected = useMemo(() => objects.find((o) => o.id === selectedId) ?? null, [objects, selectedId]);
  const bomLines = selectedId ? bomByRoot[selectedId] ?? [] : [];
  const chips = requirements.filter((r) => r.status !== 'superseded');
  const selectedState = selectedId ? coverageStateOf(selectedId, coverage) : null;

  const commitPromise = (title: string, spec: RequirementSpec | null) => {
    void proposeRequirement(serverScope, project, { title, spec });
    setComposing(false);
  };

  return (
    <div data-testid="spec-sheet-pane" className="h-full w-full flex min-h-0">
      {/* LEFT — typed object tree */}
      <div className="w-56 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="px-2 py-1.5 text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
          Object tree
        </div>
        <SystemObjectTree objects={objects} coverage={coverage} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* RIGHT — promise chips + BOM rollup + composer */}
      <div className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            {selected ? selected.name : 'All promises'}
          </span>
          {selectedState && (
            <span className={`text-3xs font-medium px-1.5 py-0.5 rounded ${COVERAGE_TINTS[selectedState].bg}`}>
              {COVERAGE_TINTS[selectedState].label}
            </span>
          )}
          <button
            type="button"
            data-testid="add-promise-button"
            onClick={() => setComposing(true)}
            className="ml-auto px-1.5 py-0.5 text-3xs font-medium rounded border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/30 text-warning-800 dark:text-warning-200 hover:bg-warning-100 dark:hover:bg-warning-900/50 transition-colors"
            title="Propose a promise (n)"
          >
            + promise <kbd className="font-mono">n</kbd>
          </button>
        </div>

        {composing && <PromiseComposer onCommit={commitPromise} onCancel={() => setComposing(false)} />}

        {/* Promise chips */}
        <div data-testid="promise-chips" className="flex flex-wrap gap-1.5">
          {chips.length === 0 ? (
            <span className="text-2xs text-gray-500 dark:text-gray-400">No promises yet — press <kbd className="font-mono">n</kbd> to propose one.</span>
          ) : (
            chips.map((r) => <RequirementChip key={r.id} spec={r.spec} fallback={r.title} />)
          )}
        </div>

        {/* BOM rollup (selected object) */}
        {selected && (
          <div data-testid="bom-rollup" className="space-y-1">
            <div className="text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">BOM rollup</div>
            {bomLines.length === 0 ? (
              <p className="text-2xs text-gray-500 dark:text-gray-400">No child objects.</p>
            ) : (
              <table className="w-full text-2xs">
                <thead>
                  <tr className="text-gray-400 dark:text-gray-500 text-left">
                    <th className="font-medium py-0.5">Type</th>
                    <th className="font-medium py-0.5 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {bomLines.map((line) => (
                    <tr key={line.typeId} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-0.5 font-mono text-gray-700 dark:text-gray-200">{line.typeId}</td>
                      <td className="py-0.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{line.totalQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Inline metric/op/target + title composer for `+ promise` (design §4/§7.2). */
const PromiseComposer: React.FC<{
  onCommit: (title: string, spec: RequirementSpec | null) => void;
  onCancel: () => void;
}> = ({ onCommit, onCancel }) => {
  const [metric, setMetric] = useState('');
  const [op, setOp] = useState('');
  const [target, setTarget] = useState('');

  const commit = () => {
    const m = metric.trim();
    if (!m) return; // metric is the minimum — a promise must name what it measures
    const hasSpec = m && op.trim() && target.trim();
    const num = Number(target);
    const spec: RequirementSpec | null = hasSpec
      ? { metric: m, op: op.trim(), target: Number.isNaN(num) ? target.trim() : num }
      : null;
    const title = hasSpec ? `${m} ${op.trim()} ${target.trim()}` : m;
    onCommit(title, spec);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      onCancel();
    }
  };

  const field = 'min-w-0 px-1 py-0.5 text-2xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100';

  return (
    <div data-testid="promise-composer" className="flex items-center gap-1 rounded border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-1.5" onKeyDown={onKeyDown}>
      <input aria-label="metric" placeholder="metric" value={metric} onChange={(e) => setMetric(e.target.value)} className={`${field} flex-1`} autoFocus />
      <input aria-label="op" placeholder="op" value={op} onChange={(e) => setOp(e.target.value)} className={`${field} w-12`} />
      <input aria-label="target" placeholder="target" value={target} onChange={(e) => setTarget(e.target.value)} className={`${field} flex-1`} />
      <button type="button" onClick={commit} title="Propose (↵)" className="px-1.5 py-0.5 text-3xs font-medium rounded bg-warning-500 text-white hover:bg-warning-600 transition-colors">↵</button>
      <button type="button" onClick={onCancel} title="Cancel (esc)" className="px-1 py-0.5 text-3xs rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">✕</button>
    </div>
  );
};

export default SpecSheetPane;
