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
import { EMBED_TOOL_DEFS, handleEmbedTool } from '../embed-tools.js';
import { IMAGE_TOOL_DEFS, handleImageTool } from '../image-tools.js';
import { DOCUMENT_TOOL_DEFS, handleDocumentTool } from '../document-tools.js';
import { BROWSER_TOOL_DEFS, handleBrowserTool } from '../browser-tools.js';
import { SPREADSHEET_TOOL_DEFS, handleSpreadsheetTool } from '../spreadsheet-tools.js';
import { DIAGRAM_TOOL_DEFS, handleDiagramTool } from '../diagram-tools.js';

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

  it('EMBED_TOOL_DEFS declares exactly the expected embed surface', () => {
    expect(new Set(EMBED_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set(['create_embed', 'list_embeds', 'delete_embed', 'create_storybook_embed', 'list_storybook_stories']),
    );
  });

  it('every EMBED_TOOL_DEFS name is wired in handleEmbedTool', async () => {
    for (const def of EMBED_TOOL_DEFS) {
      expect(await isRecognized(handleEmbedTool, def.name)).toBe(true);
    }
  });

  it('handleEmbedTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleEmbedTool('definitely_not_an_embed_tool', {})).toBeNull();
  });

  it('IMAGE_TOOL_DEFS declares exactly the expected image surface', () => {
    expect(new Set(IMAGE_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set(['create_image', 'generate_image', 'list_audio', 'list_images', 'get_image', 'delete_image']),
    );
  });

  it('every IMAGE_TOOL_DEFS name is wired in handleImageTool', async () => {
    for (const def of IMAGE_TOOL_DEFS) {
      expect(await isRecognized(handleImageTool, def.name)).toBe(true);
    }
  });

  it('handleImageTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleImageTool('definitely_not_an_image_tool', {})).toBeNull();
  });

  it('DOCUMENT_TOOL_DEFS declares exactly the expected document surface', () => {
    expect(new Set(DOCUMENT_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set([
        'list_documents', 'get_document', 'create_document', 'update_document',
        'patch_document', 'get_document_history', 'revert_document', 'delete_document',
        'preview_document',
      ]),
    );
  });

  it('every DOCUMENT_TOOL_DEFS name is wired in handleDocumentTool', async () => {
    for (const def of DOCUMENT_TOOL_DEFS) {
      expect(await isRecognized(handleDocumentTool, def.name)).toBe(true);
    }
  });

  it('handleDocumentTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleDocumentTool('definitely_not_a_document_tool', {})).toBeNull();
  });

  it('every BROWSER_TOOL_DEFS name is wired in handleBrowserTool', async () => {
    expect(BROWSER_TOOL_DEFS.length).toBe(30);
    for (const def of BROWSER_TOOL_DEFS) {
      expect(await isRecognized(handleBrowserTool, def.name)).toBe(true);
    }
  });

  it('handleBrowserTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleBrowserTool('definitely_not_a_browser_tool', {})).toBeNull();
  });

  it('SPREADSHEET_TOOL_DEFS declares exactly the expected spreadsheet surface', () => {
    expect(new Set(SPREADSHEET_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set([
        'list_spreadsheets', 'get_spreadsheet', 'create_spreadsheet', 'update_spreadsheet',
        'delete_spreadsheet', 'get_spreadsheet_history', 'revert_spreadsheet', 'patch_spreadsheet',
        'export_spreadsheet_csv',
      ]),
    );
  });

  it('every SPREADSHEET_TOOL_DEFS name is wired in handleSpreadsheetTool', async () => {
    for (const def of SPREADSHEET_TOOL_DEFS) {
      expect(await isRecognized(handleSpreadsheetTool, def.name)).toBe(true);
    }
  });

  it('handleSpreadsheetTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleSpreadsheetTool('definitely_not_a_spreadsheet_tool', {})).toBeNull();
  });

  it('DIAGRAM_TOOL_DEFS declares exactly the expected diagram surface', () => {
    expect(new Set(DIAGRAM_TOOL_DEFS.map((d) => d.name))).toEqual(
      new Set([
        'list_diagrams', 'get_diagram', 'create_diagram', 'update_diagram', 'validate_diagram',
        'preview_diagram', 'transpile_diagram', 'export_diagram_svg', 'export_diagram_png',
        'get_diagram_history', 'revert_diagram', 'design_to_diagram', 'diagram_from_code', 'patch_diagram',
      ]),
    );
  });

  it('every DIAGRAM_TOOL_DEFS name is wired in handleDiagramTool', async () => {
    for (const def of DIAGRAM_TOOL_DEFS) {
      expect(await isRecognized(handleDiagramTool, def.name)).toBe(true);
    }
  });

  it('handleDiagramTool returns null for an unknown name (fall-through sentinel)', async () => {
    expect(await handleDiagramTool('definitely_not_a_diagram_tool', {})).toBeNull();
  });
});
