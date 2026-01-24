import React from 'react';

interface DiffControlsProps {
  hasDiff: boolean;
  onClearDiff: () => void;
}

export function DiffControls({ hasDiff, onClearDiff }: DiffControlsProps) {
  if (!hasDiff) {
    return null;
  }

  return (
    <div className="diff-controls">
      <span className="diff-badge">Showing changes</span>
      <button onClick={onClearDiff} className="clear-diff-btn">
        Clear Diff
      </button>
    </div>
  );
}
