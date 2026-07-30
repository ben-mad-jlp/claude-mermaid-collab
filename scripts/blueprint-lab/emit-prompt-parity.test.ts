import { describe, test, expect } from 'bun:test';
import { buildV2BlueprintPrompt } from './emit';
import { MANIFEST_JSON_SCHEMA_LINES, MANIFEST_SCHEMA_NOTES_LINES } from '../../src/services/leaf-prompts';
import type { CorpusCase } from './corpus';

/** Parity guard (bug d9ae1c52): the blueprint-lab emit prompt must embed the SAME v2 schema +
 *  citability teaching the production blueprint node emits (src/services/leaf-prompts.ts), so a
 *  lab measurement reflects what the daemon actually does — not a divergent hardcoded copy. If the
 *  production prompt changes and the lab is not re-synced, this test fails. */

const sample: CorpusCase = {
  id: 'parity-sample',
  leafKind: 'feature',
  spec: { title: 'Add a helper', description: 'add computeX to util' },
} as unknown as CorpusCase;

describe('blueprint-lab emit prompt parity with production', () => {
  const prompt = buildV2BlueprintPrompt(sample);

  test('embeds the production v2 schema block verbatim', () => {
    expect(prompt).toContain(MANIFEST_JSON_SCHEMA_LINES.join('\n'));
  });

  test('embeds the production schema notes (incl. the citability teaching) verbatim', () => {
    expect(prompt).toContain(MANIFEST_SCHEMA_NOTES_LINES.join('\n'));
    // The distinctive "restate absence as positive" lesson must be present.
    expect(prompt).toContain('There is NO way to express "X is absent"');
  });
});
