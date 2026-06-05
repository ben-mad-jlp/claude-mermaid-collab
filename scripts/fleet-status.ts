/**
 * Print the live coordinator fleet for a project: which todo is on which worker,
 * how long it's been running, lease headroom, and health state.
 *
 *   bun run scripts/fleet-status.ts [projectRoot]
 *
 * Defaults to the current repo. Read-only — observes, never mutates.
 */
import { getFleetStatus, type WorkerState } from '../src/services/fleet-status.ts';

const project = process.argv[2] ?? process.cwd();

function dur(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(Math.abs(ms) / 1000);
  const sign = ms < 0 ? '-' : '';
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  return `${sign}${m}m${String(s % 60).padStart(2, '0')}s`;
}

const ICON: Record<WorkerState, string> = {
  working: '🟢 working',
  idle: '🟡 idle',
  permission: '🔑 permission',
  dead_shell: '💀 dead-shell',
  no_tmux: '⚰️  no-tmux',
  unknown: '❔ unknown',
};

const fs = getFleetStatus(project);
console.log(`\nFleet — ${project}`);
console.log(`in_progress=${fs.summary.inProgress}  working=${fs.summary.working}  idle=${fs.summary.idle}  permission=${fs.summary.permission}  dead/gone=${fs.summary.deadOrGone}  over-lease=${fs.summary.overLease}\n`);
if (fs.entries.length === 0) {
  console.log('  (no in-progress todos)\n');
} else {
  for (const e of fs.entries) {
    const lease = e.overLease ? `OVER by ${dur(e.leaseRemainingMs)}` : `${dur(e.leaseRemainingMs)} left`;
    const tgt = e.targetProject && !e.targetProject.endsWith(project.split('/').pop() ?? '') ? `  →${e.targetProject.split('/').pop()}` : '';
    const tool = e.blockedOnTool ? ` (${e.blockedOnTool})` : '';
    console.log(`  ${ICON[e.state]}${tool}  ${e.worker.padEnd(11)} ${dur(e.elapsedMs).padStart(7)} elapsed  ·  lease ${lease}  ·  retries=${e.retryCount}${tgt}`);
    console.log(`      ${e.todoId.slice(0, 8)}  ${e.title.slice(0, 88)}`);
  }
  console.log('');
}
