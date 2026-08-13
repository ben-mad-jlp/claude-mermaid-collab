// @nested-test-runner
/**
 * Tests for the backend test runner's process.execPath spawn fix.
 * Asserts that the inner runner uses process.execPath (PATH-independent) instead of bare 'bun'.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { test, expect, afterAll } from 'bun:test';

test('test-backend inner runner spawns process.execPath, not a bare bun', () => {
  // Source-shape test: verify the production file references process.execPath
  // and does not contain the bare bun spawn forms.
  const productionFile = readFileSync(join(import.meta.dir, '../test-backend.ts'), 'utf8');

  // Assert process.execPath is referenced in the file
  expect(productionFile).toContain('process.execPath');

  // Build needle literals by concatenation to avoid false positives from this test file itself
  const singleQuotedForm = "Bun.spawn(['" + "bun'";
  const doubleQuotedForm = 'Bun.spawn(["' + 'bun"';

  // Assert neither bare-bun spawn form appears in the production file
  expect(productionFile).not.toContain(singleQuotedForm);
  expect(productionFile).not.toContain(doubleQuotedForm);
});

test('process.execPath resolves as a test runner with no bun on PATH', async () => {
  // Behavioral test: create a temp test file and run it with process.execPath
  // in an environment where bun is not on PATH, proving path-independent resolution.

  const tmpDir = mkdtempSync(join(tmpdir(), 'bun-spawn-path-test-'));

  try {
    // Write a minimal passing test file that imports only from bun:test
    const testFile = join(tmpDir, 'minimal.test.ts');
    const testContent = `import { test, expect } from 'bun:test';\n\ntest('ok', () => {\n  expect(1).toBe(1);\n});\n`;
    Bun.write(testFile, testContent);

    // Spawn with a restricted PATH that doesn't include bun
    const proc = Bun.spawn([process.execPath, 'test', '--timeout', '30000', testFile], {
      env: { ...process.env, PATH: '/usr/bin:/bin' },
      cwd: tmpDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Drain stdout/stderr to avoid deadlock on full pipe
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;

    // Assert successful exit
    expect(code).toBe(0);
  } finally {
    // Clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true });
  }
}, { timeout: 60000 });
