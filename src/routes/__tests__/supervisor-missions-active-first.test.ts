/**
 * Regression: GET /api/supervisor/missions must never truncate the ACTIVE mission off
 * page 1.
 *
 * The route paginates listMissions() (creation order) at a default cap of
 * DEFAULT_MISSIONS_LIST_LIMIT. Before the active-first sort, a project with more than that
 * many missions — mostly terminal — pushed a recently-created active mission past the first
 * page, so the UI's page-1 glance rendered "No active mission" while one was live
 * (observed 2026-07-29 for mission 2b74bb49 at raw index 53 of 54). The route now sorts
 * active-first, then non-terminal-first, then newest-first, mirroring the MCP
 * list_missions contract — so the (at most one) active mission is always page-1 index 0
 * and accumulating converged missions can never crowd out live ones.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'missions-active-first-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

// Imports AFTER the env is set so every db opens against our temp dir.
import { createTodo, _closeProject } from '../../services/todo-store';
import {
  upsertMission,
  setMissionActive,
  setMissionAbandoned,
  _resetMissionDbCache,
} from '../../services/mission-store';
import { DEFAULT_MISSIONS_LIST_LIMIT } from '../supervisor-routes';
import { handleSupervisorRoutes } from '../supervisor-routes';

// More live missions than fit on one default page, so a page-1 truncation is possible.
const LIVE_MISSIONS = DEFAULT_MISSIONS_LIST_LIMIT + 2; // 52
const TERMINAL_MISSIONS = 5;

let project: string;
let activeId = '';
const terminalIds: string[] = [];

// upsertMission defaults active=1, so a freshly-created mission is "active" until the
// lifecycle deactivates it (queue-enqueue) or it goes terminal (self-heal clears it). Model
// reality — exactly ONE active mission per project — by explicitly setting the flag here.
async function makeMission(title: string, active: boolean): Promise<string> {
  const node = await createTodo(project, {
    ownerSession: 's1', title: `[MISSION] ${title}`, kind: 'mission', missionId: null,
  });
  upsertMission(project, node.id);
  setMissionActive(project, node.id, active);
  return node.id;
}

async function getMissions(query: string): Promise<{ status: number; body: any }> {
  const req = new Request(`http://x/api/supervisor/missions?${query}`);
  const res = await handleSupervisorRoutes(req, new URL(req.url));
  return { status: res!.status, body: await res!.json() };
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'missions-active-first-'));

  // (1) LIVE_MISSIONS non-active, non-terminal missions — the crowd that fills page 1.
  for (let i = 0; i < LIVE_MISSIONS; i++) await makeMission(`live ${i}`, false);

  // (2) The ACTIVE mission, created AFTER the crowd — in raw creation order it lands near
  //     the END of the list, past the page-1 cap (the exact shape of the observed bug).
  activeId = await makeMission('the active one', true);

  // (3) TERMINAL missions, created LAST of all (newest createdAt) — without non-terminal-
  //     first they would sort to the top by recency and displace live missions on page 1.
  for (let i = 0; i < TERMINAL_MISSIONS; i++) {
    const id = await makeMission(`abandoned ${i}`, false);
    setMissionAbandoned(project, id, Date.now());
    terminalIds.push(id);
  }

  _closeProject(project);
  _resetMissionDbCache(project);
});

afterAll(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
  rmSync(SUP_DIR, { recursive: true, force: true });
});

describe('GET /api/supervisor/missions keeps the active mission on page 1', () => {
  test('the active mission is page-1 index 0 under the default cap', async () => {
    const { status, body } = await getMissions(`project=${encodeURIComponent(project)}`);
    expect(status).toBe(200);
    // Page is capped, so NOT every mission comes back...
    expect(body.missions.length).toBe(DEFAULT_MISSIONS_LIST_LIMIT);
    expect(body.nextCursor).not.toBeNull();
    // ...but the active mission is present, and first.
    expect(body.missions[0].node.id).toBe(activeId);
    const page1Ids: string[] = body.missions.map((m: any) => m.node.id);
    expect(page1Ids).toContain(activeId);
  });

  test('non-terminal missions sort ahead of terminal ones (terminal ones off page 1)', async () => {
    const { body } = await getMissions(`project=${encodeURIComponent(project)}`);
    const page1Ids: string[] = body.missions.map((m: any) => m.node.id);
    // The terminal missions are the NEWEST rows; by recency alone they'd top the list.
    // non-terminal-first must keep every one of them off the (full) first page.
    for (const id of terminalIds) expect(page1Ids).not.toContain(id);
  });

  test('the active mission still leads when the whole set is requested', async () => {
    const { body } = await getMissions(
      `project=${encodeURIComponent(project)}&limit=500`,
    );
    expect(body.missions[0].node.id).toBe(activeId);
    // Every terminal mission sorts after every non-terminal one.
    const ids: string[] = body.missions.map((m: any) => m.node.id);
    const isTerm = (id: string) => terminalIds.includes(id);
    const lastNonTerminalIdx = Math.max(...ids.map((id, i) => (isTerm(id) ? -1 : i)));
    const firstTerminalIdx = Math.min(...ids.map((id, i) => (isTerm(id) ? i : Infinity)));
    expect(firstTerminalIdx).toBeGreaterThan(lastNonTerminalIdx);
  });
});
