import { describe, it, expect } from 'bun:test';
import { EPIC_TOOL_DEFS } from '../epic-tools.js';
import { GROUP_REGISTRY, buildAdvertisedTools } from '../advertised-tools.js';

describe('advertised-tools reorder invariance', () => {
  it('swapping two entries positions within a source group does not change the resolved output', () => {
    // Find leaf_inspect and mutation_probe in EPIC_TOOL_DEFS by name
    const leafInspectIdx = EPIC_TOOL_DEFS.findIndex((d) => d.name === 'leaf_inspect');
    const mutationProbeIdx = EPIC_TOOL_DEFS.findIndex((d) => d.name === 'mutation_probe');

    if (leafInspectIdx === -1) {
      throw new Error('leaf_inspect not found in EPIC_TOOL_DEFS');
    }
    if (mutationProbeIdx === -1) {
      throw new Error('mutation_probe not found in EPIC_TOOL_DEFS');
    }

    // Create a shallow copy with the two entries swapped
    const swappedEpic = [...EPIC_TOOL_DEFS];
    [swappedEpic[leafInspectIdx], swappedEpic[mutationProbeIdx]] = [
      swappedEpic[mutationProbeIdx],
      swappedEpic[leafInspectIdx],
    ];

    // Build advertised tools with the original group and with the swapped group
    const original = buildAdvertisedTools(GROUP_REGISTRY as any);
    // Create a new groups object with swapped EPIC but copy all other groups from GROUP_REGISTRY
    const swappedGroups = {} as any;
    // Manually copy all groups from GROUP_REGISTRY through the Proxy
    const groupNames = ['SESSION', 'DIAGRAM', 'DOCUMENT', 'DESIGN', 'SYSTEM', 'BROWSER', 'DESKTOP', 'SUPERVISOR', 'EPIC', 'DECISION', 'MISSION', 'WORKGRAPH', 'SPREADSHEET', 'SNIPPET', 'EMBED', 'IMAGE', 'ARTIFACT_INBOX', 'ARTIFACT_SEND'] as const;
    for (const name of groupNames) {
      swappedGroups[name] = GROUP_REGISTRY[name];
    }
    // Replace EPIC with the swapped version
    swappedGroups.EPIC = swappedEpic;

    const swapped = buildAdvertisedTools(swappedGroups);

    // Extract tool names from both (they should be in the same order)
    const originalNames = original.tools.map((t) => t.name);
    const swappedNames = swapped.tools.map((t) => t.name);

    // The sequences should be identical because resolution is by name, not position
    if (originalNames.length !== swappedNames.length) {
      throw new Error(
        `Length mismatch: original has ${originalNames.length} tools, swapped has ${swappedNames.length}`
      );
    }

    for (let i = 0; i < originalNames.length; i++) {
      if (originalNames[i] !== swappedNames[i]) {
        throw new Error(
          `Name mismatch at index ${i}: original[${i}]="${originalNames[i]}", swapped[${i}]="${swappedNames[i]}"`
        );
      }
    }
  });
});
