import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DesktopControl } from './desktop-control';

describe('DesktopControl build stamp', () => {
  let control: DesktopControl;
  let url: string;
  let token: string;

  beforeEach(async () => {
    control = new DesktopControl({} as unknown as any);
    const result = await control.start();
    url = result.url;
    token = result.token;
  });

  afterEach(async () => {
    await control.stop();
  });

  it('/main/ping returns a non-empty mainBuildSha and mainBuiltAt', async () => {
    const response = await fetch(`${url}/main/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.mainBuildSha).toBe('string');
    expect((body.mainBuildSha as string).length).toBeGreaterThan(0);
    expect(typeof body.mainBuiltAt).toBe('string');
    expect((body.mainBuiltAt as string).length).toBeGreaterThan(0);
  });

  it('/main/ping still returns ok, pid and ts', async () => {
    const response = await fetch(`${url}/main/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.pid).toBe('number');
    expect(body.pid).toBeGreaterThan(0);
    expect(typeof body.ts).toBe('number');
    expect(body.ts).toBeGreaterThan(0);
  });

  it('/main/ping without the bearer token answers 401 unauthorized', async () => {
    const response = await fetch(`${url}/main/ping`);
    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });
});
