import { describe, test, expect } from 'bun:test';
import { handleSupervisorRoutes } from '../supervisor-routes';
import { addWatchedProject } from '../../services/supervisor-store';

async function get(project?: string) {
  const qs = project === undefined ? '' : `?project=${encodeURIComponent(project)}`;
  const req = new Request(`http://x/api/supervisor/injection-flags${qs}`, { method: 'GET' });
  return handleSupervisorRoutes(req, new URL(req.url));
}

async function post(body: unknown) {
  const req = new Request('http://x/api/supervisor/injection-flags', { method: 'POST', body: JSON.stringify(body) });
  return handleSupervisorRoutes(req, new URL(req.url));
}

describe('GET/POST /api/supervisor/injection-flags', () => {
  test('GET without project → 400', async () => {
    const res = await get();
    expect(res?.status).toBe(400);
  });

  test('GET returns the {digest,retryContext,activeConstraints} trio (all boolean)', async () => {
    const res = await get('/tmp/inject-p');
    expect(res?.status).toBe(200);
    const json = (await res!.json()) as any;
    expect(typeof json.digest).toBe('boolean');
    expect(typeof json.retryContext).toBe('boolean');
    expect(typeof json.activeConstraints).toBe('boolean');
  });

  test('POST toggles a flag and echoes the updated trio', async () => {
    const project = '/tmp/inject-toggle-p';
    // The per-project flag setters are UPDATE-only by design (2a06c2a4: a setter must NOT auto-watch
    // a project — that floods the Projects list). So the toggle persists only for an already-watched
    // project; in production the injection-flags UI is only shown for watched projects.
    addWatchedProject(project);
    const on = await post({ project, flag: 'digest', value: true });
    expect(on?.status).toBe(200);
    expect(((await on!.json()) as any).digest).toBe(true);

    const readBack = await get(project);
    expect(((await readBack!.json()) as any).digest).toBe(true);

    const off = await post({ project, flag: 'digest', value: false });
    expect(((await off!.json()) as any).digest).toBe(false);
  });

  test('POST with an unknown flag → 400', async () => {
    const res = await post({ project: '/tmp/inject-p', flag: 'nope', value: true });
    expect(res?.status).toBe(400);
  });

  test('POST with a non-boolean value → 400', async () => {
    const res = await post({ project: '/tmp/inject-p', flag: 'digest', value: 'yes' });
    expect(res?.status).toBe(400);
  });
});
