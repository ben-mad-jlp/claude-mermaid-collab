import { readFile } from 'node:fs/promises';
import type { WebSocketHandler } from '../websocket/handler.ts';
import { ideState } from '../services/ide-state.ts';
import { tmuxBaseName } from '../services/tmux-naming.js';
import { getSupervisedLaunchProject } from '../services/supervisor-store.ts';
import { sendTmuxKeys } from '../services/tmux-send.ts';
import { launchAndBind } from '../services/claude-launch.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function handleIdeRoutes(req: Request, url: URL, wsHandler: WebSocketHandler): Promise<Response | null> {
  if (url.pathname === '/api/ide/status' && req.method === 'GET') {
    return Response.json(ideState.getStatus());
  }

  if (url.pathname === '/api/ide/focus-terminal' && req.method === 'POST') {
    try {
      const { claudeSessionId } = await req.json() as { claudeSessionId?: string };
      if (!claudeSessionId || !UUID_RE.test(claudeSessionId)) {
        return jsonError('claudeSessionId must be a valid UUID', 400);
      }

      const bindingPath = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
      let bindingRaw: string;
      try {
        bindingRaw = await readFile(bindingPath, 'utf-8');
      } catch (err: any) {
        if (err?.code === 'ENOENT') return jsonError('Session not registered or binding missing', 404);
        return jsonError(`Failed to read binding: ${err?.message || String(err)}`, 500);
      }

      let binding: { claudePid?: string | number; project?: string; session?: string };
      try {
        binding = JSON.parse(bindingRaw);
      } catch {
        return jsonError('Corrupt binding file', 500);
      }

      if (!binding.claudePid) return jsonError('claudePid not available for this session', 404);

      wsHandler.broadcastToChannel('ide', {
        type: 'ide_focus_terminal',
        claudePid: Number(binding.claudePid),
        claudeSessionId,
        project: binding.project ?? '',
        session: binding.session ?? '',
      });

      return Response.json({ success: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/ide/create-terminal' && req.method === 'POST') {
    try {
      const { session, project } = await req.json() as { session?: string; project?: string };
      if (!session || typeof session !== 'string') {
        return jsonError('session is required', 400);
      }
      if (!project || typeof project !== 'string') {
        return jsonError('project is required', 400);
      }
      // Cross-project workers (coordinator spawn with targetProject != tracking
      // project) had their tmux created under the LAUNCH project, but the
      // supervised row is keyed by the tracking project — so deriving the tmux
      // name from `project` here attached to the wrong/empty session. Resolve the
      // launch project the worker was actually launched under (null → same as
      // `project`) and derive the tmux name + cwd from it, so we hit the SAME
      // session. Same-project case is unchanged (launchProject is null).
      const launchProject = getSupervisedLaunchProject(project, session) ?? project;
      const tmuxSession = tmuxBaseName(launchProject, session);
      const { isTmuxAvailable } = await import('../services/tmux-availability.js');
      const tmuxAvailable = await isTmuxAvailable();
      if (tmuxAvailable) {
        // Self-heal a pre-fix session parked in the wrong dir before (re)creating.
        const { healStaleTmuxSession } = await import('../services/tmux-session.js');
        await healStaleTmuxSession(tmuxSession, launchProject);
        try {
          // `-c launchProject` so the session's panes start in the worker's actual
          // project directory. This handler usually wins the race against POST
          // /api/terminal/sessions (which also sets cwd), so without `-c` the
          // session would be created in the *server* process's cwd (e.g. the app
          // Resources dir) and `claude`/`git` would run against the wrong folder.
          // `-c` is ignored by tmux if the session already exists (desired no-op).
          const proc = Bun.spawn(
            ['tmux', 'new-session', '-d', '-s', tmuxSession, '-c', launchProject],
            { stdout: 'ignore', stderr: 'ignore' }
          );
          await proc.exited; // ok if it fails (session already exists)
        } catch (e: any) {
          // tmux vanished between the probe and here — degrade gracefully: still
          // broadcast the WS event so any IDE-side listener can react.
          console.warn(
            `[ide/create-terminal] tmux spawn failed (${e?.code ?? 'unknown'}): ${e?.message ?? String(e)} — treating as soft no-op`
          );
        }
      }
      wsHandler.broadcastToChannel('ide', {
        type: 'ide_open_terminal',
        session,
        project,
        tmuxSession,
      });
      return Response.json({ success: true, tmux: tmuxAvailable });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/ide/tmux-send-keys' && req.method === 'POST') {
    try {
      const { project, session, text, submit, quiet } = await req.json() as { project?: string; session?: string; text?: string; submit?: boolean; quiet?: boolean };
      if (!project || typeof project !== 'string') {
        return jsonError('project is required', 400);
      }
      if (!session || typeof session !== 'string') {
        return jsonError('session is required', 400);
      }
      if (!text || typeof text !== 'string') {
        return jsonError('text is required', 400);
      }
      // Default true → existing callers (supervisor nudge) byte-identical; a
      // compose-stage quick-reply chip passes submit:false to type without Enter.
      const doSubmit = submit !== false;
      const result = await sendTmuxKeys(project, session, text, { submit: doSubmit });
      if (result.reason === 'no-session') return jsonError('tmux session not found', 404);
      // This route is the nudge-delivery endpoint (the supervisor's remote
      // nudge peerFetches it). Broadcast so a user watching THIS server sees a
      // toast for nudges that land here, mirroring the local-nudge broadcast in
      // the supervisor_nudge MCP handler. A compose-stage (submit:false) is not
      // a nudge — it stages text for the user to edit — so don't broadcast it.
      // `quiet` suppresses the toast for USER-originated sends (the terminal
      // composer + quick-reply chips): a person typing into their own session is
      // not a supervisor nudge. Real supervisor/remote nudges omit `quiet`.
      if (doSubmit && !quiet) {
        wsHandler.broadcast({ type: 'supervisor_nudge', project, session, serverId: '', text, sent: result.sent });
      }
      return Response.json({ success: true, tmux: result.sent });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/ide/open-diff' && req.method === 'POST') {
    const timeoutPromise = new Promise<Response>(resolve =>
      setTimeout(() => resolve(Response.json({ error: 'IDE request timed out' }, { status: 504 })), 3000)
    );
    const handlerPromise = (async () => {
      try {
        const { filePath } = await req.json() as { filePath?: string };
        if (!filePath || !filePath.startsWith('/')) {
          return jsonError('filePath must be a non-empty absolute path', 400);
        }

        wsHandler.broadcastToChannel('ide', {
          type: 'ide_open_diff',
          filePath,
        });

        ideState.diffOpened(filePath);
        return Response.json({ success: true });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
      }
    })();
    return Promise.race([handlerPromise, timeoutPromise]);
  }

  if (url.pathname === '/api/ide/tmux-sessions' && req.method === 'GET') {
    try {
      const proc = Bun.spawn(['tmux', 'ls', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const sessions = stdout.trim().split('\n').filter(Boolean);
      return Response.json({ sessions });
    } catch {
      return Response.json({ sessions: [] });
    }
  }

  if (url.pathname === '/api/ide/launch-session' && req.method === 'POST') {
    try {
      const { project, session, allowedTools, invokeSkill, remoteControl } = await req.json() as { project?: string; session?: string; role?: string; allowedTools?: string; invokeSkill?: string; remoteControl?: boolean };
      if (!project || typeof project !== 'string') return jsonError('project is required', 400);
      if (!session || typeof session !== 'string') return jsonError('session is required', 400);
      const result = await launchAndBind({ project, session, allowedTools, invokeSkill, remoteControl });
      return Response.json(result);
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  return null;
}
