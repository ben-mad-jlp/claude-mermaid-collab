import { describe, it, expect } from 'bun:test';
import { setupMCPServer } from '../setup.js';
import { MISSION_TOOL_DEFS } from '../mission-tools.js';
import { WORKGRAPH_TOOL_DEFS } from '../workgraph-tools.js';
import { SNIPPET_TOOL_DEFS } from '../snippet-tools.js';
import { EMBED_TOOL_DEFS } from '../embed-tools.js';
import { IMAGE_TOOL_DEFS } from '../image-tools.js';
import { DOCUMENT_TOOL_DEFS } from '../document-tools.js';
import { BROWSER_TOOL_DEFS } from '../browser-tools.js';
import { SPREADSHEET_TOOL_DEFS } from '../spreadsheet-tools.js';
import { DIAGRAM_TOOL_DEFS } from '../diagram-tools.js';
import { DESIGN_TOOL_DEFS } from '../design-tools.js';
import { SUPERVISOR_TOOL_DEFS } from '../supervisor-tools.js';
import { EPIC_TOOL_DEFS } from '../epic-tools.js';
import { DECISION_TOOL_DEFS } from '../decision-tools.js';
import { SYSTEM_TOOL_DEFS } from '../system-tools.js';
import { SESSION_TOOL_DEFS } from '../session-tools.js';
import { DESKTOP_TOOL_DEFS } from '../desktop-tools.js';
import { GROUP_REGISTRY } from '../advertised-tools.js';

// Entries in DEFS arrays that are intentionally NOT advertised via ListTools
const DELIBERATELY_UNADVERTISED: Record<string, Set<string>> = {
  SESSION_TOOL_DEFS: new Set(['add_session_todo']), // pinned non-registration: src/mcp/tools/__tests__/session-todos.test.ts:119-120
};

const GROUPS: Array<{ label: string; defs: Array<{ name: string }> }> = [
  { label: 'MISSION_TOOL_DEFS', defs: MISSION_TOOL_DEFS },
  { label: 'WORKGRAPH_TOOL_DEFS', defs: WORKGRAPH_TOOL_DEFS },
  { label: 'SNIPPET_TOOL_DEFS', defs: SNIPPET_TOOL_DEFS },
  { label: 'EMBED_TOOL_DEFS', defs: EMBED_TOOL_DEFS },
  { label: 'IMAGE_TOOL_DEFS', defs: IMAGE_TOOL_DEFS },
  { label: 'DOCUMENT_TOOL_DEFS', defs: DOCUMENT_TOOL_DEFS },
  { label: 'BROWSER_TOOL_DEFS', defs: BROWSER_TOOL_DEFS },
  { label: 'SPREADSHEET_TOOL_DEFS', defs: SPREADSHEET_TOOL_DEFS },
  { label: 'DIAGRAM_TOOL_DEFS', defs: DIAGRAM_TOOL_DEFS },
  { label: 'DESIGN_TOOL_DEFS', defs: DESIGN_TOOL_DEFS },
  { label: 'SUPERVISOR_TOOL_DEFS', defs: SUPERVISOR_TOOL_DEFS },
  { label: 'EPIC_TOOL_DEFS', defs: EPIC_TOOL_DEFS },
  { label: 'DECISION_TOOL_DEFS', defs: DECISION_TOOL_DEFS },
  { label: 'SYSTEM_TOOL_DEFS', defs: SYSTEM_TOOL_DEFS },
  { label: 'SESSION_TOOL_DEFS', defs: SESSION_TOOL_DEFS },
  { label: 'DESKTOP_TOOL_DEFS', defs: DESKTOP_TOOL_DEFS },
];

describe('tool defs vs advertised ListTools parity', () => {
  it('every group DEFS name set matches its advertised subset (modulo exclusions)', async () => {
    const server = await setupMCPServer();
    const handler = (server as any)._requestHandlers.get('tools/list');

    if (!handler) {
      throw new Error('tools/list handler not found');
    }

    // Invoke the handler to get advertised tools
    const actual = await handler({ method: 'tools/list', params: {} }, {} as any);
    const advertisedSet = new Set(actual.tools.map((t: any) => t.name));

    // Forward direction: every declared DEFS name (minus exclusions) must be advertised
    for (const { label, defs } of GROUPS) {
      const excluded = DELIBERATELY_UNADVERTISED[label] ?? new Set<string>();
      const declared = new Set(defs.map((d) => d.name));

      for (const name of declared) {
        if (excluded.has(name)) continue;
        if (!advertisedSet.has(name)) {
          throw new Error(`Group ${label}: declared name "${name}" is not advertised`);
        }
      }
    }

    // Assignment-completeness check: every declared name (minus exclusions) must be
    // resolvable in GROUP_REGISTRY by name. Collect all unassigned names first and
    // throw one Error naming all of them.
    const unassignedNames: string[] = [];
    for (const { label, defs } of GROUPS) {
      const excluded = DELIBERATELY_UNADVERTISED[label] ?? new Set<string>();
      const groupLabel = label.replace('_TOOL_DEFS', ''); // Convert label to registry key (e.g., 'SESSION_TOOL_DEFS' → 'SESSION')

      for (const def of defs) {
        if (excluded.has(def.name)) continue;
        const registryGroup = GROUP_REGISTRY[groupLabel];
        if (!registryGroup) {
          unassignedNames.push(`${def.name} (group "${groupLabel}" not in registry)`);
        } else if (!registryGroup.find((d) => d.name === def.name)) {
          unassignedNames.push(`${def.name} (not found in GROUP_REGISTRY["${groupLabel}"])`);
        }
      }
    }

    if (unassignedNames.length > 0) {
      throw new Error(`Unassigned tools: ${unassignedNames.join(', ')}`);
    }

    // Reverse direction: count of advertised names per group must match declared count
    for (const { label, defs } of GROUPS) {
      const excluded = DELIBERATELY_UNADVERTISED[label] ?? new Set<string>();
      const declared = new Set(defs.map((d) => d.name));
      const expectedCount = declared.size - excluded.size;

      // Count how many advertised names belong to this group's declared set
      let advertisedInGroup = 0;
      for (const name of declared) {
        if (!excluded.has(name) && advertisedSet.has(name)) {
          advertisedInGroup++;
        }
      }

      if (advertisedInGroup !== expectedCount) {
        throw new Error(`Group ${label}: expected ${expectedCount} advertised names, found ${advertisedInGroup}`);
      }
    }
  });
});

// Future additions to DELIBERATELY_UNADVERTISED must include a paired test pinning
// the non-registration, mirroring the citation at SESSION_TOOL_DEFS above.
