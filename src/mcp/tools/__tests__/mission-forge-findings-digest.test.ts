import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-forge-findings-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { forgeMission } from '../mission-forge';
import { _resetMissionDbCache } from '../../../services/mission-store';
import { createTodo, _closeProject as closeTodos } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';
import { recordFinding, _closeProject as closeFindings } from '../../../services/finding-store';
import { ensureBucket } from '../../../services/bucket-registry';
import { readMissionDigest } from '../../../services/mission-digest';
import { composeInjectedContext } from '../../../services/prompt-injection';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-forge-findings-'));
  _resetMissionDbCache(project);
});
afterEach(() => {
  _resetMissionDbCache(project);
  closeTodos(project);
  closeDecisions(project);
  closeFindings(project);
  rmSync(project, { recursive: true, force: true });
});

describe('mission-forge with consumed findings digest', () => {
  test('forgeMission with no digest input but a consumed finding produces an injected digest with claim/ruledOut/truncated files and no narrative leakage', async () => {
    const bucketId = await ensureBucket(project, 'explore');
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      kind: 'leaf',
      title: 'Leaf for finding',
      description: 'NARRATIVE-BLOB-unique123',
      parentId: bucketId,
    });

    // Record a finding with 8 implicated files (will truncate to 5, showing "+3 more")
    const files = Array.from({ length: 8 }, (_, i) => `path/to/file${i}.ts`);
    await recordFinding(project, {
      todoId: leaf.id,
      violatedClaim: 'VIOLATED-CLAIM-unique456',
      ruledOut: ['RULED-OUT-unique789'],
      implicatedFiles: files,
      reproPath: 'src/__quarantine__/x.test.ts',
    });

    // Forge a mission consuming the leaf, with no digest input
    const r = await forgeMission(project, {
      session: 's1',
      title: 'Fix the issue',
      criteria: ['the issue is fixed'],
      consumesTodoIds: [leaf.id],
    });

    // Assert digestWritten is true (findings were found and written)
    expect(r.digestWritten).toBe(true);

    // Read the digest and verify its contents
    const digest = readMissionDigest(project, r.missionId);
    expect(digest).toBeTruthy();
    expect(digest).toContain('## Consumed findings');
    expect(digest).toContain('VIOLATED-CLAIM-unique456');
    expect(digest).toContain('RULED-OUT-unique789');
    expect(digest).toContain('path/to/file0.ts');
    expect(digest).toContain('+3 more');

    // Verify it does NOT leak narrative or repro path
    expect(digest).not.toContain('NARRATIVE-BLOB-unique123');
    expect(digest).not.toContain('src/__quarantine__/x.test.ts');

    // Test end-to-end: compose the injected context and verify the digest is present
    const injected = composeInjectedContext({
      kind: 'blueprint',
      project,
      flags: { digest: true, retryContext: false, activeConstraints: false },
    });
    expect(injected).toContain('VIOLATED-CLAIM-unique456');
  });

  test('forgeMission consuming a bucket leaf with no finding row and no digest input writes nothing', async () => {
    const bucketId = await ensureBucket(project, 'explore');
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      kind: 'leaf',
      title: 'Leaf with no finding',
      parentId: bucketId,
    });

    // Forge without providing a digest and without a finding row
    const r = await forgeMission(project, {
      session: 's1',
      title: 'Process this bucket item',
      criteria: ['the item is processed'],
      consumesTodoIds: [leaf.id],
    });

    // Assert digestWritten is false
    expect(r.digestWritten).toBe(false);

    // Assert no digest was written
    const digest = readMissionDigest(project, r.missionId);
    expect(digest).toBeNull();
  });
});
