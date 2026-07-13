import React, { useState } from 'react';
import type { UnlandedEpic } from '@/stores/supervisorStore';
import type { RailKey } from './rail/RailNav';

export interface UnlandedStripProps {
  unlandedEpics?: UnlandedEpic[];
  onSelectPanel?: (key: RailKey) => void;
}

export const UnlandedStrip: React.FC<UnlandedStripProps> = ({ unlandedEpics, onSelectPanel }) => {
  const unlanded = unlandedEpics ?? [];
  const [collapsed, setCollapsed] = useState(false);

  if (unlanded.length === 0) {
    return null;
  }

  const unlandedCommits = unlanded.reduce((n, e) => n + e.ahead, 0);

  return (
    <div data-testid="unlanded-strip" className="px-3 py-2 bg-white dark:bg-gray-900">
      <div data-testid="unlanded-epics" className="space-y-1 rounded-md border border-warning-400 card-pulse-amber p-2 text-black">
        <button
          type="button"
          onClick={() => {
            onSelectPanel?.('land');
            setCollapsed((c) => !c);
          }}
          aria-expanded={!collapsed}
          className="w-full flex items-center gap-2 text-xs font-semibold text-black"
        >
          <span aria-hidden="true">⚠</span>
          <span>{unlanded.length} epic{unlanded.length === 1 ? '' : 's'} unlanded</span>
          <span className="font-normal text-gray-700">· {unlandedCommits} commit{unlandedCommits === 1 ? '' : 's'} off master</span>
          <svg
            className={`w-3 h-3 ml-auto text-gray-600 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        {!collapsed && (
          <ul className="space-y-0.5">
            {unlanded.map((e) => (
              <li key={e.branch} className="flex items-center justify-between text-2xs text-gray-800 tabular-nums">
                <span className="font-mono truncate">{e.branch}</span>
                <span className="ml-2 shrink-0">+{e.ahead}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default UnlandedStrip;
