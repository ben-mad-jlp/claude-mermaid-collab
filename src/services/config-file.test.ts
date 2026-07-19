import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getConfiguredPort,
  setConfiguredPort,
  getConfigEntries,
  _resetConfigCache,
} from './config-file.ts';

describe('getConfiguredPort / setConfiguredPort', () => {
  let dir: string;
  let prevConfigPath: string | undefined;
  let prevPort: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mermaid-config-file-test-'));
    prevConfigPath = process.env.MERMAID_CONFIG_PATH;
    prevPort = process.env.PORT;
    process.env.MERMAID_CONFIG_PATH = join(dir, 'config.json');
    delete process.env.PORT;
    _resetConfigCache();
  });

  afterEach(() => {
    if (prevConfigPath === undefined) delete process.env.MERMAID_CONFIG_PATH;
    else process.env.MERMAID_CONFIG_PATH = prevConfigPath;
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    _resetConfigCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 9002 when no env and no file value is set', () => {
    expect(getConfiguredPort()).toBe(9002);
  });

  it('returns the config.json port when no env is set', () => {
    setConfiguredPort(8080);
    expect(getConfiguredPort()).toBe(8080);
  });

  it('prefers process.env.PORT over config.json', () => {
    setConfiguredPort(8080);
    process.env.PORT = '7000';
    expect(getConfiguredPort()).toBe(7000);
  });

  it('returns 0 when process.env.PORT is "0"', () => {
    process.env.PORT = '0';
    expect(getConfiguredPort()).toBe(0);
  });

  it('throws on a non-numeric PORT', () => {
    process.env.PORT = 'not-a-number';
    expect(() => getConfiguredPort()).toThrow('Invalid PORT value');
  });

  it('throws on an out-of-range PORT', () => {
    process.env.PORT = '70000';
    expect(() => getConfiguredPort()).toThrow('Invalid PORT value: 70000 is out of valid range');
  });

  it('throws on an out-of-range port from config.json', () => {
    setConfiguredPort(-1);
    expect(() => getConfiguredPort()).toThrow('Invalid PORT value');
  });

  it('setConfiguredPort persists to config.json and getConfiguredPort reflects it', () => {
    setConfiguredPort(8123);
    expect(getConfiguredPort()).toBe(8123);
    expect(getConfigEntries().port).toBe('8123');
  });
});
