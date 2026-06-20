import { mux, argvCapturePane } from './session-mux/index.ts';
import { tmuxBaseName } from './tmux-naming.js';
import { getSupervisedLaunchProject } from './supervisor-store.ts';

/** Capture the raw scrollback of a watched session's tmux pane (on-demand, NOT a stream).
 *  Resolves the launch project (cross-project workers) like the create-terminal path.
 *  Mirrors session-summary-loop.ts capturePaneLocal. */
export async function capturePaneText(project: string, session: string, scrollback = 100): Promise<string> {
  const launchProject = getSupervisedLaunchProject(project, session) ?? project;
  const tmuxName = tmuxBaseName(launchProject, session);
  try {
    const proc = Bun.spawn(mux.cmd(argvCapturePane(tmuxName, scrollback)), {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const [stdout] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
      proc.exited,
    ]);
    return stdout;
  } catch {
    return '';
  }
}
