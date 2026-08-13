// verify-deployed-build.ts — post-deploy probe that fails the deploy loudly if
// the running build doesn't match the manifest.
//
// Usage:
//   bun scripts/verify-deployed-build.ts
//
// Exit codes:
//   0 — deployed build matches manifest
//   1 — mismatch or verification failed
//
// Environment:
//   APP_PATH               path to the .app bundle (default /Applications/Mermaid Collab.app)
//   MC_PORT                port the sidecar listens on (default 9002)
//   MC_DESKTOP_CONTROL_URL path to the Electron main control endpoint (optional)
//   MC_DESKTOP_CONTROL_TOKEN auth token for the control endpoint (optional)

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { VerifyDeployDeps } from '../src/services/deploy-verify';
import { verifyDeployedBuild, servedOwnerOk } from '../src/services/deploy-verify';
import { writeDeployVerification } from '../src/services/deploy-service';

export interface VerifyProbeIO {
  log(line: string): void;
  writeVerification: typeof writeDeployVerification;
  deps: VerifyDeployDeps;
}

export async function runVerifyDeployedBuild(io: VerifyProbeIO): Promise<number> {
  const result = await verifyDeployedBuild(io.deps);

  if (!result.ok) {
    for (const code of result.mismatches) {
      let expected = 'unknown';
      let actual = 'unknown';

      try {
        switch (code) {
          case 'head-sha-mismatch': {
            const manifest = io.deps.readManifest?.(io.deps.resourcesPath);
            expected = manifest?.headSha ?? 'unknown';
            try {
              const headShaCall = await Promise.resolve(io.deps.expectedHeadSha());
              actual = headShaCall ?? 'unknown';
            } catch {
              actual = 'unknown';
            }
            break;
          }
          case 'ui-bundle-mismatch': {
            const manifest = io.deps.readManifest?.(io.deps.resourcesPath);
            expected = manifest?.uiBundle ?? 'unknown';
            try {
              const html = await io.deps.servedIndexHtml();
              const match = html?.match(/index-[a-f0-9]+\.js/);
              actual = match?.[0] ?? 'unknown';
            } catch {
              actual = 'unknown';
            }
            break;
          }
          case 'asar-hash-mismatch': {
            const manifest = io.deps.readManifest?.(io.deps.resourcesPath);
            expected = manifest?.asarSha256 ?? 'unknown';
            actual = io.deps.hashAsar?.() ?? 'unknown';
            break;
          }
          case 'main-build-sha-mismatch': {
            const manifest = io.deps.readManifest?.(io.deps.resourcesPath);
            expected = manifest?.sidecarSha256 ?? 'unknown';
            try {
              const ping = await io.deps.mainPing?.();
              actual = ping?.buildSha ?? 'unknown';
            } catch {
              actual = 'unknown';
            }
            break;
          }
          case 'served-owner-not-app': {
            expected = 'deployed app sidecar';
            try {
              const health = await io.deps.health();
              actual = health?.exePath ?? 'unknown';
            } catch {
              actual = 'unknown';
            }
            break;
          }
          case 'manifest-missing': {
            expected = 'build-manifest.json at $APP_PATH/Contents/Resources';
            actual = 'file not found';
            break;
          }
        }
      } catch {
        // Ignore errors computing expected/actual; use defaults.
      }

      io.log(`mismatch ${code}: expected="${expected}" actual="${actual}"`);
    }
  }

  let headShaResult = 'unknown';
  try {
    const headShaCall = await Promise.resolve(io.deps.expectedHeadSha());
    headShaResult = headShaCall ?? 'unknown';
  } catch {
    // use default 'unknown'
  }

  io.writeVerification({
    ok: result.ok,
    buildVerified: result.ok,
    headSha: headShaResult,
    mismatches: result.mismatches,
    message: result.ok ? 'build verified' : `${result.mismatches.length} mismatch(es)`,
  });

  return result.ok ? 0 : 1;
}

export function realProbeDeps(env: NodeJS.ProcessEnv = process.env): VerifyDeployDeps {
  const appPath = env.APP_PATH || '/Applications/Mermaid Collab.app';
  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const mcPort = env.MC_PORT || '9002';

  return {
    resourcesPath,
    appPath,
    expectedHeadSha: () => {
      const result = spawnSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf-8',
      });
      return (result.stdout ?? '').trim();
    },
    health: async () => {
      try {
        const response = await fetch(`http://localhost:${mcPort}/api/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return null;
        return (await response.json()) as { exePath?: string; owner?: string } | null;
      } catch {
        return null;
      }
    },
    servedIndexHtml: async () => {
      try {
        const response = await fetch(`http://localhost:${mcPort}/`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return null;
        return await response.text();
      } catch {
        return null;
      }
    },
    hashAsar: () => {
      try {
        const asarPath = join(resourcesPath, 'app.asar');
        if (!existsSync(asarPath)) return null;
        const content = readFileSync(asarPath);
        return createHash('sha256').update(content).digest('hex');
      } catch {
        return null;
      }
    },
    mainPing: env.MC_DESKTOP_CONTROL_URL
      ? async () => {
          try {
            const response = await fetch(
              `${env.MC_DESKTOP_CONTROL_URL}/main/ping`,
              {
                headers: {
                  authorization: `Bearer ${env.MC_DESKTOP_CONTROL_TOKEN}`,
                },
                signal: AbortSignal.timeout(3000),
              },
            );
            if (!response.ok) return null;
            return (await response.json()) as { buildSha?: string } | null;
          } catch {
            return null;
          }
        }
      : undefined,
  };
}

if (import.meta.main) {
  const deps = realProbeDeps(process.env);
  const io: VerifyProbeIO = {
    log: (line: string) => console.log(line),
    writeVerification: writeDeployVerification,
    deps,
  };

  runVerifyDeployedBuild(io).then((code) => {
    process.exit(code);
  }).catch((err) => {
    console.error(`[verify-deployed-build] ${(err as Error).message}`);
    process.exit(1);
  });
}
