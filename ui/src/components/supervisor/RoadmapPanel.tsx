import React, { useEffect, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { RoadmapItem } from '@/stores/supervisorStore';
import { roadmapToMermaid } from './roadmapToMermaid';
import { MermaidPreview } from '@/components/editors/MermaidPreview';

export interface RoadmapPanelProps {
  serverId: string;
  project: string;
}

type Mode = 'graph' | 'waves' | 'list';

const STATUS_GLYPH: Record<string, string> = {
  done: '●',
  completed: '●',
  in_progress: '◐',
  inprogress: '◐',
  ready: '○',
  planned: '○',
  blocked: '⊘',
  dropped: '⌀',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'text-green-600 dark:text-green-400',
  completed: 'text-green-600 dark:text-green-400',
  in_progress: 'text-blue-600 dark:text-blue-400',
  inprogress: 'text-blue-600 dark:text-blue-400',
  ready: 'text-gray-500 dark:text-gray-400',
  planned: 'text-gray-400 dark:text-gray-500',
  blocked: 'text-yellow-600 dark:text-yellow-400',
  dropped: 'text-gray-400 dark:text-gray-500 line-through',
};

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

function RoadmapListItem({ item }: { item: RoadmapItem }) {
  const glyph = STATUS_GLYPH[item.status] ?? '○';
  const colorCls = STATUS_COLOR[item.status] ?? 'text-gray-500';

  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <span className={`mt-0.5 text-xs font-mono select-none ${colorCls}`} title={item.status}>
        {glyph}
      </span>
      <span className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-tight">
        {item.title}
      </span>
      {item.sessionName && (
        <span className="shrink-0 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
          {item.sessionName}
        </span>
      )}
    </div>
  );
}

export const RoadmapPanel: React.FC<RoadmapPanelProps> = ({ serverId, project }) => {
  const roadmapByProject = useSupervisorStore((s) => s.roadmapByProject);
  const loadRoadmap = useSupervisorStore((s) => s.loadRoadmap);

  const items: RoadmapItem[] = roadmapByProject[project] ?? [];
  const [mode, setMode] = useState<Mode>('graph');

  useEffect(() => {
    if (serverId && project) {
      loadRoadmap(serverId, project);
    }
  }, [serverId, project, loadRoadmap]);

  const inProgress = items.filter(
    (i) => i.status === 'in_progress' || i.status === 'inprogress',
  ).length;
  const blocked = items.filter((i) => i.status === 'blocked').length;

  const sortedItems = [...items].sort((a, b) => a.ord - b.ord);

  const modeButton = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      className={`px-2 py-0.5 text-xs rounded transition-colors ${
        mode === m
          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Roadmap
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            · {projectBasename(project)}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {modeButton('graph', 'Graph')}
          {modeButton('waves', 'Waves')}
          {modeButton('list', 'List')}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No roadmap items for this project.
            </p>
          </div>
        ) : mode === 'list' ? (
          <div className="p-2 space-y-0.5">
            {sortedItems.map((item) => (
              <RoadmapListItem key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="h-full min-h-[200px]">
            <MermaidPreview
              content={roadmapToMermaid(items, { mode })}
              hideEditToggle
              className="h-full"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {items.length} items · {inProgress} in progress · {blocked} blocked
      </div>
    </div>
  );
};

export default RoadmapPanel;
