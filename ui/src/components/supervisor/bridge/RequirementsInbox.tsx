/**
 * RequirementsInbox — the confirm-loop heartbeat (design-system-object-ui §3, P0).
 *
 * A sibling BELOW NeedsYouZone in Bridge's left column. Mirrors the
 * BridgeEscalationInbox shell + keyboard drain, but in AMBER (one-red discipline:
 * red is reserved for escalations; a promise awaiting signature is amber).
 *
 * Keyboard drain (same muscle memory as escalations): `1`/`↵` approve · `e` edit
 * (inline composer → changed re-sign) · `3` reject · auto-advance to the next
 * card. `changed` items sort to the top so re-signs are never buried.
 *
 * Derives its set from the single project-scoped selector (`selectInboxRequirements`)
 * — the same one the Proposed(N) badge counts — so the list depth and the badge
 * can never disagree.
 */

import React, { useState } from 'react';
import { useSupervisorStore, type Requirement, type RequirementSpec } from '@/stores/supervisorStore';
import { useKeyboardOwner, KeyboardPriority } from '@/hooks/useKeyboardOwner';
import { selectInboxRequirements, predecessorOf } from './requirementSelectors';
import { RequirementCard } from './RequirementCard';

/** True when focus is in a field where the drain keys must not fire. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

export interface RequirementsInboxProps {
  /** Full (or already project-scoped) requirements list — scoped here via the shared selector. */
  requirements: Requirement[];
  project: string;
  serverScope: string;
}

export const RequirementsInbox: React.FC<RequirementsInboxProps> = ({
  requirements,
  project,
  serverScope,
}) => {
  const decideRequirement = useSupervisorStore((s) => s.decideRequirement);

  const inbox = selectInboxRequirements(requirements, project);

  // Drain the active card with the keyboard; answering removes it from `inbox`
  // so the keys fall through to the next one.
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const clampedActive = inbox.length > 0 ? Math.min(activeIdx, inbox.length - 1) : 0;

  const approve = (r: Requirement) => {
    void decideRequirement(serverScope, project, r.id, 'approve');
    setActiveIdx(0);
  };
  const reject = (r: Requirement) => {
    void decideRequirement(serverScope, project, r.id, 'reject');
    setActiveIdx(0);
  };
  const commitEdit = (r: Requirement, spec: RequirementSpec) => {
    void decideRequirement(serverScope, project, r.id, 'edit', { spec });
    setEditingId(null);
    setActiveIdx(0);
  };

  // Batch-dismiss-by-source: reject every Cartographer-authored (ghost) proposal
  // in one action so an inferred batch can be cleared without per-card drudgery
  // (design-cartographer §5). Reuses the existing reject path — no new surface.
  const cartographerInbox = inbox.filter((r) => r.authorSession === 'cartographer');
  const dismissAllCartographer = () => {
    for (const r of cartographerInbox) {
      void decideRequirement(serverScope, project, r.id, 'reject');
    }
    setActiveIdx(0);
  };

  useKeyboardOwner(
    KeyboardPriority.SIGNALS,
    (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (editingId) return;
      const active = inbox[clampedActive];
      if (!active) return;

      if (ev.key === '1' || ev.key === 'Enter') {
        ev.preventDefault();
        approve(active);
      } else if (ev.key === 'e' || ev.key === 'E') {
        ev.preventDefault();
        setEditingId(active.id);
      } else if (ev.key === '3') {
        ev.preventDefault();
        reject(active);
      }
    },
    inbox.length > 0,
  );

  if (inbox.length === 0) return null; // empty inbox is silent — no card noise

  return (
    <div
      data-testid="requirements-inbox"
      data-proposed={inbox.length}
      className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-2 space-y-2"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">▲ Requirements Inbox</span>
        <span className="text-2xs font-bold px-1.5 rounded-full bg-warning-500 text-white">{inbox.length}</span>
        {cartographerInbox.length > 0 && (
          <button
            type="button"
            data-testid="dismiss-all-cartographer"
            onClick={dismissAllCartographer}
            className="ml-auto text-3xs font-medium px-1.5 py-0.5 rounded border border-dashed border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Reject all Cartographer-inferred proposals at once"
          >
            ✕ dismiss all {cartographerInbox.length} from ⌖ Cartographer
          </button>
        )}
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {inbox.map((r, idx) => (
          <RequirementCard
            key={r.id}
            requirement={r}
            priorSpec={r.status === 'changed' ? predecessorOf(r, requirements)?.spec ?? null : null}
            active={idx === clampedActive}
            editing={editingId === r.id}
            onApprove={() => approve(r)}
            onReject={() => reject(r)}
            onStartEdit={() => setEditingId(r.id)}
            onCommitEdit={(spec) => commitEdit(r, spec)}
            onCancelEdit={() => setEditingId(null)}
            onHover={() => setActiveIdx(idx)}
          />
        ))}
        <p className="text-3xs text-gray-400 dark:text-gray-500 px-0.5 pt-0.5">
          <kbd className="font-mono">1</kbd>/<kbd className="font-mono">↵</kbd> approve · <kbd className="font-mono">e</kbd> edit · <kbd className="font-mono">3</kbd> reject
        </p>
      </div>
    </div>
  );
};

export default RequirementsInbox;
