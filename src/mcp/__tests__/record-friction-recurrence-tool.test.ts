import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleSessionTool } from '../session-tools.js';
import { _closeProject } from '../../services/friction-store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join('/var/folders/df/46_3zwkn7vb9p8sv93r1qqz40000gn/T', 'record-friction-recurrence-test-'));
});

afterEach(() => {
  _closeProject(tmpDir);
  rmSync(tmpDir, { recursive: true });
});

describe('record_friction dispatch with recurrence tracking', () => {
  it('record_friction dispatch returns signature, priorCount and prior note ids', async () => {
    const layer = 'operational';
    const retryReason = 'test-recurrence-reason';
    const detail = 'test recurrence detail';

    // Call 1: first occurrence
    const result1Str = await handleSessionTool('record_friction', {
      project: tmpDir,
      layer,
      retryReason,
      detail,
    });
    expect(result1Str).toBeDefined();
    const result1 = JSON.parse(result1Str!);
    expect(result1.success).toBe(true);
    expect(result1.note).toBeDefined();
    expect(result1.signature).toBeDefined();
    expect(result1.priorCount).toBe(0);
    expect(result1.priorNoteIds).toEqual([]);
    const note1Id = result1.note.id;

    // Call 2: second occurrence (same signature)
    const result2Str = await handleSessionTool('record_friction', {
      project: tmpDir,
      layer,
      retryReason,
      detail,
    });
    expect(result2Str).toBeDefined();
    const result2 = JSON.parse(result2Str!);
    expect(result2.success).toBe(true);
    expect(result2.note).toBeDefined();
    expect(result2.signature).toBe(result1.signature);
    expect(result2.priorCount).toBe(1);
    expect(result2.priorNoteIds).toEqual([note1Id]);
    const note2Id = result2.note.id;

    // Call 3: third occurrence (same signature)
    const result3Str = await handleSessionTool('record_friction', {
      project: tmpDir,
      layer,
      retryReason,
      detail,
    });
    expect(result3Str).toBeDefined();
    const result3 = JSON.parse(result3Str!);
    expect(result3.success).toBe(true);
    expect(result3.note).toBeDefined();
    expect(result3.signature).toBe(result1.signature);
    expect(result3.priorCount).toBeGreaterThanOrEqual(2);
    // priorNoteIds should contain the first two note ids, but NOT the third note's id
    expect(result3.priorNoteIds).toContain(note1Id);
    expect(result3.priorNoteIds).toContain(note2Id);
    expect(result3.priorNoteIds).not.toContain(result3.note.id);
  });

  it('recordFrictionTool body is wired to recordFrictionWithRecurrence', () => {
    const sourceFile = 'src/mcp/tools/friction.ts';
    const source = readFileSync(join(process.cwd(), sourceFile), 'utf-8');

    // Verify that recordFrictionWithRecurrence is imported
    expect(source).toMatch(/import\s*{[^}]*recordFrictionWithRecurrence[^}]*}\s*from\s*['"][^'"]*friction-store/);

    // Extract the recordFrictionTool function body
    const toolMatch = source.match(/export\s+async\s+function\s+recordFrictionTool\s*\([^)]*\)[^{]*\{[\s\S]*?\n\}/);
    expect(toolMatch).toBeDefined();
    const toolBody = toolMatch![0];

    // Verify the tool calls recordFrictionWithRecurrence
    expect(toolBody).toContain('recordFrictionWithRecurrence');

    // Verify it does NOT call the plain recordFriction inside recordFrictionTool
    // (Only reportDogfoodTool is allowed to keep using recordFriction)
    const recordFrictionCallInTool = toolBody.match(/[^a-zA-Z]recordFriction\(/);
    expect(recordFrictionCallInTool).toBeNull();
  });
});
