/**
 * isolateRegistries — redirect the project + session registry SINGLETONS to
 * throwaway temp files so a test's register()/discover() can NEVER write into the
 * real ~/.mermaid-collab registries.
 *
 * Why this exists: the live desktop server reads those real registries; a test that
 * calls `projectRegistry.register(...)` or `sessionRegistry.register(...)` against
 * the un-isolated singleton leaks `test-*` projects into the running app's Projects
 * list (the project-discovery path surfaces any session's project too, so isolating
 * ONLY the project registry is not enough — the session registry must be isolated as
 * well). Call in beforeEach; await the returned cleanup in afterEach.
 */
import { join } from 'path';
import { tmpdir } from 'os';
import * as fs from 'fs';
import { rm } from 'fs/promises';
import { projectRegistry } from '../services/project-registry';
import { sessionRegistry } from '../services/session-registry';

export function isolateRegistries(tag = 'test'): () => Promise<void> {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projPath = join(tmpdir(), `mc-iso-projects-${stamp}.json`);
  const sessPath = join(tmpdir(), `mc-iso-sessions-${stamp}.json`);
  // registryPath is private on both singletons; defineProperty is the established
  // override hook (api.test.ts already used it for the project registry). load()/
  // save() read this.registryPath, and the session registry derives its .bak/.tmp
  // from it, so this redirects every write.
  Object.defineProperty(projectRegistry, 'registryPath', { value: projPath, writable: true, configurable: true });
  Object.defineProperty(sessionRegistry, 'registryPath', { value: sessPath, writable: true, configurable: true });
  return async () => {
    for (const p of [projPath, sessPath, `${sessPath}.bak`, `${sessPath}.tmp`]) {
      if (fs.existsSync(p)) await rm(p, { force: true }).catch(() => {});
    }
  };
}
