import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodo, _closeProject } from '../../services/todo-store';
import { handleSupervisorTool } from '../supervisor-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'get-bridge-snapshot-tool-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('get_bridge_snapshot MCP tool', () => {
  test('returns projects, todos, missions, openEscalations, coverage, summaries', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });

    const raw = await handleSupervisorTool('get_bridge_snapshot', { project });
    expect(raw).not.toBeNull();
    const snapshot = JSON.parse(raw!);
    const keys = Object.keys(snapshot).sort();
    expect(keys).toEqual(['campaigns', 'coverage', 'landsInFlight', 'missions', 'openEscalations', 'projects', 'summaries', 'todos'].sort());
  });

  test('throws without project', async () => {
    await expect(handleSupervisorTool('get_bridge_snapshot', {})).rejects.toThrow('Missing required: project');
  });
});
