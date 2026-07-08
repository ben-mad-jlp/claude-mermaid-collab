/**
 * Dispatch-coverage guard for the extracted tool groups.
 *
 * When a tool group is split out of setup.ts (SNIPPET_TOOL_DEFS + handleSnippetTool,
 * MISSION_TOOL_DEFS + handleMissionTool), the failure mode is SILENT: a tool stays
 * declared in ListTools but its handler is dropped, so the name falls through to the
 * default and returns "Unknown tool" at runtime — something tsc cannot catch.
 *
 * This test asserts every declared name in a group's *_TOOL_DEFS is actually
 * RECOGNIZED by that group's handler. We call the handler with empty args and require
 * it to NOT return null: a recognized tool either succeeds or throws its own
 * "Missing required: …" validation error, whereas an unwired name returns null
 * (the "fall through to setup.ts's switch" sentinel). Either non-null return or a
 * throw proves the case exists; a null return is the bug this guard exists to catch.
 */
import { describe, it, expect } from 'bun:test';
import { SNIPPET_TOOL_DEFS, handleSnippetTool } from '../snippet-tools.js';
import { MISSION_TOOL_DEFS, handleMissionTool } from '../mission-tools.js';

type Handler = (name: string, args: any) => Promise<string | null>;

async function isRecognized(handler: Handler, name: string): Promise<boolean> {
  try {
    const result = await handler(name, {});
    // Non-null => the case ran (and produced a result). null => unwired.
    return result !== null;
  } catch {
    // A thrown validation error means the case exists and reached its guard.
    return true;
  }
}

describe('tool dispatch coverage', () => {
  it('SNIPPET_TOOL_DEFS declares exactly the expected snippet surface', () => {
    expect(new Set(SNIPPET_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set([
        'create_snippet', 'list_snippets', 'get_snippet', 'add_design_snippet',
        'update_snippet', 'delete_snippet', 'export_snippet', 'snippet_history',
        'revert_snippet', 'patch_snippet',
      ]),
    );
  });

  it('every SNIPPET_TOOL_DEFS name is wired in handleSnippetTool', async () => {
    for (const def of SNIPPET_TOOL_DEFS) {
      expect(await isRecognized(handleSnippetTool, def.name)).toBe(true);
    }
  });

  it('handleSnippetTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleSnippetTool('definitely_not_a_snippet_tool', {})).toBeNull();
  });

  it('every MISSION_TOOL_DEFS name is wired in handleMissionTool', async () => {
    for (const def of MISSION_TOOL_DEFS) {
      expect(await isRecognized(handleMissionTool, def.name)).toBe(true);
    }
  });

  it('handleMissionTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleMissionTool('definitely_not_a_mission_tool', {})).toBeNull();
  });
});
