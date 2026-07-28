import { getWorktreeManager } from './coordinator-live';
import { recordFrictionOnce, setWatchState } from './friction-store';

export async function teardownEpic(
  wm: ReturnType<typeof getWorktreeManager>,
  epicId: string,
  targetProject: string,
  ctx: { epicBranch: string },
): Promise<void> {
  try {
    await wm.removeEpic(epicId, targetProject);
  } catch (err) {
    await recordFrictionOnce(targetProject, {
      layer: 'operational',
      retryReason: 'landed-epic-teardown-failed',
      todoId: epicId,
      detail: `removeEpic(${epicId}) failed after a successful land of ${ctx.epicBranch}: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
  }
  try { await setWatchState(targetProject, `watch:land-conflict:${epicId.slice(0, 8)}`, 'landed'); } catch { /* best-effort */ }
}
