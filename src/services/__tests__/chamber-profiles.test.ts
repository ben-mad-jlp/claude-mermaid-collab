// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  listChamberTranscript,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import {
  _closeDb as _closeOrchestratorDb,
  setNodeProfileOverride,
} from '../orchestrator-config';
import {
  CHAMBER_GENERALS,
  propose,
  type ChamberLLMFactory,
} from '../chamber';
import { NODE_PROFILE } from '../leaf-node-profile';

let project: string;
let tmpDir: string;

function isolate() {
  tmpDir = mkdtempSync(join(tmpdir(), 'chamber-profiles-'));
  process.env.MERMAID_CONFIG_PATH = join(tmpDir, 'config.json');
  process.env.MERMAID_SUPERVISOR_DIR = tmpDir;
  project = tmpDir;
  _closeOrchestratorDb();
}

beforeEach(isolate);

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  _closeOrchestratorDb();
  delete process.env.MERMAID_CONFIG_PATH;
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('chamber-profiles', () => {
  test('a project-level node profile override changes the model recorded on each general call', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Verify chamber profile override',
    });

    // Set the lens profile override for the project to 'sonnet'.
    setNodeProfileOverride(project, 'lens', 'sonnet', null, null);

    const sessionId = 'session-profile-test';
    const calls: string[] = [];

    // Stub factory that returns valid proposal JSON.
    const stubFactory: ChamberLLMFactory = (role: string, phase: string) => ({
      complete: async () => {
        calls.push(`${phase}:${role}`);
        return JSON.stringify({
          goal: `Close by improving ${role}`,
          rationale: `${role} believes this is the right closure goal`,
        });
      },
    });

    // Run propose phase WITHOUT providing a model field.
    const candidates = await propose(project, {
      campaignId: campaign.id,
      sessionId,
      decidedAtSha: 'abc1234',
      llm: stubFactory,
      // Note: NO model field provided, so chamber should resolve from the profile override.
    });

    // Verify all generals proposed.
    expect(candidates).toHaveLength(CHAMBER_GENERALS.length);

    // Read back the chamber transcript.
    const transcript = listChamberTranscript(project, campaign.id, sessionId);

    // Should have one row per general (propose phase).
    expect(transcript).toHaveLength(CHAMBER_GENERALS.length);

    // Every row should have model === 'sonnet' (the override).
    for (const row of transcript) {
      expect(row.model).toBe('sonnet');
      expect(row.phase).toBe('propose');
    }

    // Verify the default lens model does NOT appear.
    const defaultLensModel = NODE_PROFILE.lens.model;
    expect(defaultLensModel).toBe('opus'); // confirm the default is 'opus'
    for (const row of transcript) {
      expect(row.model).not.toBe('opus');
    }
  });
});
