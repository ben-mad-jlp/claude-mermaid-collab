import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const scriptPath = new URL('../../scripts/ios-build-app.sh', import.meta.url);
const pkgPath = new URL('../../package.json', import.meta.url);

describe('ios-build-app.sh', () => {
  it('1. script contains xcodegen generate', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('xcodegen generate');
  });

  it('2. script contains -scheme MermaidCollab', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('-scheme MermaidCollab');
  });

  it('3. package.json ios:build invokes ios-build-app.sh', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts['ios:build']).toContain('ios-build-app.sh');
  });
});
