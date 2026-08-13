import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { packAppAsar } from '../../../scripts/pack-app-asar';
import { readBuildManifest } from '../deploy-verify';

const scriptDir = join(import.meta.dir, '../../../scripts');

describe('deploy-desktop-asar-step', () => {
  describe('shell-shape', () => {
    it('deploy-desktop.sh packs and swaps app.asar with a backup and honours --no-asar', () => {
      const scriptContent = readFileSync(
        join(scriptDir, 'deploy-desktop.sh'),
        'utf8',
      );

      // Assert the script contains the pack-app-asar invocation
      expect(scriptContent).toContain('scripts/pack-app-asar.ts');

      // Assert the backup path is created before ditto
      expect(scriptContent).toContain('cp "$RES/app.asar" "$RES/app.asar.bak-$TS"');

      // Assert both ditto targets for asar
      expect(scriptContent).toContain('ditto "$ASAR_SRC" "$RES/app.asar"');
      expect(scriptContent).toContain('ditto "$MANIFEST_SRC" "$RES/build-manifest.json"');

      // Assert the --no-asar case arm exists
      expect(scriptContent).toContain('--no-asar) DO_ASAR=0 ;;');

      // Assert the pack failure uses die (same line as the pack invocation region)
      const packRegion = scriptContent.match(
        /cd "\$REPO" && bun scripts\/pack-app-asar\.ts[^;]*\|\| die/s,
      );
      expect(packRegion).toBeTruthy();
      expect(packRegion?.[0]).toContain('die');
    });
  });

  describe('pack core', () => {
    let tempDir: string;
    let asarPath: string;
    let manifestDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'asar-'));
      asarPath = join(tempDir, 'app.asar');
      manifestDir = join(tempDir, 'manifest');
    });

    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('packAppAsar writes a build-manifest.json that readBuildManifest parses with a non-empty headSha and the staged asar sha256', async () => {
      const testHeadSha = 'deadbeef12345678';
      const testAsarBytes = Buffer.from('test asar content');

      // Set up minimal out structure before calling packAppAsar
      mkdirSync(join(tempDir, 'out', 'main'), { recursive: true });
      writeFileSync(join(tempDir, 'out', 'main', 'index.js'), '// main');
      writeFileSync(join(tempDir, 'package.json'), '{}');

      const result = await packAppAsar({
        repoRoot: tempDir,
        doBuild: false,
        outDir: join(tempDir, 'out'),
        packageJsonPath: join(tempDir, 'package.json'),
        stageDir: join(tempDir, 'stage'),
        asarOut: asarPath,
        manifestDir,
        sidecarPath: join(tempDir, 'mc-server'),
        indexHtmlPath: join(tempDir, 'index.html'),
        headSha: () => testHeadSha,
        now: () => 1234567890000,
        packAsar: (stageDir: string, asarOut: string) => {
          // Write fixed bytes to simulate asar packing
          writeFileSync(asarOut, testAsarBytes);
        },
      });

      // Verify the manifest was written
      const manifest = readBuildManifest(manifestDir);
      expect(manifest).not.toBeNull();
      expect(manifest).toBeDefined();

      // Verify headSha is non-empty and matches injected value
      expect(manifest?.headSha).toBe(testHeadSha);
      expect(manifest?.headSha).toHaveLength(16);

      // Verify asarSha256 matches the bytes we wrote
      const expectedSha = createHash('sha256')
        .update(testAsarBytes)
        .digest('hex');
      expect(manifest?.asarSha256).toBe(expectedSha);

      // Verify the returned paths are correct
      expect(result.asarPath).toBe(asarPath);
      expect(result.manifest.headSha).toBe(testHeadSha);
    });
  });
});
