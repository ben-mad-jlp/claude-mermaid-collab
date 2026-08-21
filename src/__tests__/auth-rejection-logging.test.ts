/**
 * A rejected request must leave a trace on the SERVER.
 *
 * A phone bounced straight back to its pairing screen and the sidecar log said nothing:
 * the only evidence of the 401 was on the device (2026-08-21). These assertions pin the
 * two properties that make the log useful and safe — it records the SHAPE of the failure,
 * and it never writes a usable credential.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { checkAuth } from '../auth.ts';
import { setAuthToken } from '../services/config-file.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789';
let dir: string;
let warnings: string[];
let originalWarn: typeof console.warn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auth-log-'));
  process.env.MERMAID_CONFIG_PATH = join(dir, 'config.json');
  setAuthToken(TOKEN);
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
});

afterEach(() => {
  console.warn = originalWarn;
  delete process.env.MERMAID_CONFIG_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function call(headers: Record<string, string>, peer: string) {
  const url = new URL('http://x/api/auth/check');
  return checkAuth(new Request(url.toString(), { headers }), url, peer);
}

describe('auth rejection logging', () => {
  it('logs a 401 with the token absent when no Authorization header is sent', () => {
    const res = call({}, '100.66.182.86');
    expect(res?.status).toBe(401);
    expect(warnings.join('\n')).toContain('sent=absent');
  });

  it('logs a 401 naming the sent token length when the token is wrong', () => {
    const res = call({ authorization: 'Bearer 0000000000000000' }, '100.66.182.86');
    expect(res?.status).toBe(401);
    expect(warnings.join('\n')).toContain('len=16');
  });

  it('never writes the full expected token into the log', () => {
    call({}, '100.66.182.86');
    expect(warnings.join('\n').includes(TOKEN)).toBe(false);
  });

  it('logs nothing when the token matches', () => {
    const res = call({ authorization: `Bearer ${TOKEN}` }, '100.66.182.86');
    expect(res).toBeNull();
    expect(warnings).toHaveLength(0);
  });
});
