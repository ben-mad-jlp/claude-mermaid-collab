import type * as Monaco from 'monaco-editor';
import type { ProposalState, DiffHunk } from './types';

export interface DiffReviewCallbacks {
  onAcceptHunk: (hunkIndex: number, comment?: string) => void;
  onRejectHunk: (hunkIndex: number, comment?: string) => void;
}

export interface AppliedDiff {
  decorationIds: string[];
  zoneIds: Array<{ viewZoneId: string; hunkIndex: number }>;
}

export function clearDiffDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  prev: AppliedDiff,
): void {
  editor.changeViewZones((accessor) => {
    for (const { viewZoneId } of prev.zoneIds) {
      accessor.removeZone(viewZoneId);
    }
  });
  editor.deltaDecorations(prev.decorationIds, []);
}

function buildRemovedLinesNode(removedLines: string[]): HTMLElement {
  const block = document.createElement('div');
  block.className = 'mc-diff-removed-block';
  for (const line of removedLines) {
    const row = document.createElement('div');
    row.className = 'mc-diff-removed-line';
    row.textContent = line;
    block.appendChild(row);
  }
  return block;
}

function buildHunkActionNode(
  hunk: DiffHunk,
  proposedBy: 'claude' | 'user',
  callbacks: DiffReviewCallbacks,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mc-diff-hunk-actions';

  const label = document.createElement('span');
  label.className = 'mc-diff-hunk-label';
  label.textContent = `${proposedBy === 'claude' ? 'Claude' : 'User'} proposed —`;
  row.appendChild(label);

  const commentInput = document.createElement('input');
  commentInput.className = 'mc-diff-hunk-comment';
  commentInput.type = 'text';
  commentInput.placeholder = 'Add a comment…';
  commentInput.addEventListener('click', (e) => e.stopPropagation());
  commentInput.addEventListener('keydown', (e) => e.stopPropagation());
  row.appendChild(commentInput);

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'mc-diff-hunk-btn mc-diff-hunk-accept';
  acceptBtn.textContent = 'Accept hunk';
  acceptBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onAcceptHunk(hunk.hunkIndex, commentInput.value || undefined);
  });
  row.appendChild(acceptBtn);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'mc-diff-hunk-btn mc-diff-hunk-reject';
  rejectBtn.textContent = 'Reject hunk';
  rejectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    callbacks.onRejectHunk(hunk.hunkIndex, commentInput.value || undefined);
  });
  row.appendChild(rejectBtn);

  return row;
}

export function applyDiffDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monacoInstance: typeof Monaco,
  proposal: ProposalState,
  callbacks: DiffReviewCallbacks,
): AppliedDiff {
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  const zoneIds: Array<{ viewZoneId: string; hunkIndex: number }> = [];

  const sortedHunks = [...proposal.hunks].sort((a, b) => a.startLine - b.startLine);

  for (const hunk of sortedHunks) {
    if (hunk.addedLines.length > 0) {
      decorations.push({
        range: new monacoInstance.Range(hunk.startLine, 1, hunk.endLine, 1),
        options: { isWholeLine: true, className: 'mc-diff-added-line' },
      });
      decorations.push({
        range: new monacoInstance.Range(hunk.startLine, 1, hunk.endLine, 1),
        options: { isWholeLine: true, glyphMarginClassName: 'mc-diff-added-glyph' },
      });
    }
  }

  const decorationIds = editor.deltaDecorations([], decorations);

  editor.changeViewZones((accessor) => {
    for (const hunk of sortedHunks) {
      if (hunk.removedLines.length > 0) {
        const domNode = buildRemovedLinesNode(hunk.removedLines);
        accessor.addZone({
          afterLineNumber: Math.max(0, hunk.startLine - 1),
          heightInLines: hunk.removedLines.length,
          domNode,
        });
      }

      const actionDomNode = buildHunkActionNode(hunk, proposal.proposedBy, callbacks);
      const afterLine = hunk.addedLines.length > 0 ? hunk.endLine : Math.max(0, hunk.startLine - 1);
      const id = accessor.addZone({
        afterLineNumber: afterLine,
        heightInLines: 1.8,
        domNode: actionDomNode,
      });
      zoneIds.push({ viewZoneId: id, hunkIndex: hunk.hunkIndex });
    }
  });

  return { decorationIds, zoneIds };
}

export function injectDiffStyles(): void {
  const styleId = 'mc-diff-styles';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .mc-diff-added-line { background-color: rgba(34, 197, 94, 0.15) !important; }
    .mc-diff-added-glyph { background-color: #22c55e; width: 4px !important; border-radius: 2px; }
    .mc-diff-removed-block {
      font-family: inherit; font-size: inherit; line-height: inherit;
      padding: 0 8px; background-color: rgba(239, 68, 68, 0.08);
      border-left: 3px solid #ef4444; display: block; width: 100%;
    }
    .mc-diff-removed-line {
      color: #ef4444; opacity: 0.75; white-space: pre; display: block;
    }
    .mc-diff-hunk-actions {
      display: flex; align-items: center; gap: 6px;
      padding: 2px 8px 2px 20px; font-size: 11px;
      background-color: rgba(249, 250, 251, 0.97);
      border-bottom: 1px solid #e5e7eb; width: 100%; box-sizing: border-box;
    }
    .mc-diff-hunk-label { color: #6b7280; margin-right: 2px; }
    .mc-diff-hunk-comment {
      flex: 1; min-width: 0; max-width: 200px;
      border: 1px solid #d1d5db; border-radius: 3px;
      padding: 1px 5px; font-size: 11px; line-height: 1.4;
      font-family: inherit; background-color: transparent;
      color: inherit; outline: none;
    }
    .mc-diff-hunk-btn {
      cursor: pointer; border: 1px solid; border-radius: 3px;
      padding: 1px 6px; font-size: 11px; line-height: 1.4; font-family: inherit;
    }
    .mc-diff-hunk-accept { border-color: #22c55e; color: #16a34a; background-color: transparent; }
    .mc-diff-hunk-reject { border-color: #d1d5db; color: #6b7280; background-color: transparent; }
  `;
  document.head.appendChild(style);
}
