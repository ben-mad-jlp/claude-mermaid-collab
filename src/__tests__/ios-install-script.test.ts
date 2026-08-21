import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const scriptPath = new URL('../../scripts/ios-install-device.sh', import.meta.url);

describe('ios-install-device.sh', () => {
  it('1. script targets generic/platform=iOS', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('generic/platform=iOS');
  });

  it('2. script reads DEVICE_NAME', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('DEVICE_NAME');
  });

  it('3. script installs via devicectl', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('devicectl device install');
  });
});
