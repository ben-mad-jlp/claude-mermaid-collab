import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OnboardingDbService } from '../onboarding-db.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let service: OnboardingDbService;

function setupTopics(projectDir: string) {
  const topicsDir = join(projectDir, '.collab', 'kodex', 'topics');

  // Create topic: api-auth
  const apiAuthDir = join(topicsDir, 'api-auth');
  mkdirSync(apiAuthDir, { recursive: true });
  writeFileSync(join(apiAuthDir, 'conceptual.md'), '# API Authentication\nHandles JWT tokens and session management.');
  writeFileSync(join(apiAuthDir, 'technical.md'), '## Implementation\nUses bearer tokens with refresh flow.');
  writeFileSync(join(apiAuthDir, 'files.md'), '- src/auth/service.ts\n- src/auth/middleware.ts');

  // Create topic: dashboard
  const dashDir = join(topicsDir, 'dashboard');
  mkdirSync(dashDir, { recursive: true });
  writeFileSync(join(dashDir, 'conceptual.md'), '# Dashboard\nMain dashboard showing KPIs and widgets.');
  writeFileSync(join(dashDir, 'technical.md'), '## React Components\nUses Zustand for state management.');
  writeFileSync(join(dashDir, 'files.md'), '- src/pages/Dashboard.tsx\n- src/stores/dashboardStore.ts');
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'onboarding-db-test-'));
  setupTopics(tmpDir);
  service = new OnboardingDbService(tmpDir);
});

afterEach(() => {
  service.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('FTS5 search', () => {
  test('returns results with snippets', () => {
    service.ensureIndex();
    const results = service.search('authentication');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].topicName).toBe('api-auth');
    expect(results[0].snippet).toContain('<mark>');
  });

  test('returns empty for no match', () => {
    service.ensureIndex();
    const results = service.search('nonexistentterm12345');
    expect(results).toHaveLength(0);
  });

  test('scoped search filters by topic', () => {
    service.ensureIndex();
    const results = service.search('dashboard', ['dashboard']);
    expect(results.every(r => r.topicName === 'dashboard')).toBe(true);
  });
});

describe('User CRUD', () => {
  test('creates and lists users', () => {
    const user = service.createUser('Alice');
    expect(user.id).toBeDefined();
    expect(user.name).toBe('Alice');

    const users = service.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Alice');
  });

  test('gets user by id', () => {
    const created = service.createUser('Bob');
    const found = service.getUser(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Bob');
  });

  test('returns null for nonexistent user', () => {
    expect(service.getUser(999)).toBeNull();
  });

  test('enforces unique names', () => {
    service.createUser('Charlie');
    expect(() => service.createUser('Charlie')).toThrow();
  });
});

describe('Progress tracking', () => {
  test('marks and retrieves progress', () => {
    const user = service.createUser('Alice');
    service.markProgress(user.id, 'api-auth', 'explored');

    const progress = service.getUserProgress(user.id);
    expect(progress).toHaveLength(1);
    expect(progress[0].topicName).toBe('api-auth');
    expect(progress[0].status).toBe('explored');
  });

  test('deletes progress (undo)', () => {
    const user = service.createUser('Alice');
    service.markProgress(user.id, 'api-auth', 'explored');
    service.deleteProgress(user.id, 'api-auth');

    const progress = service.getUserProgress(user.id);
    expect(progress).toHaveLength(0);
  });

  test('replaces progress status', () => {
    const user = service.createUser('Alice');
    service.markProgress(user.id, 'api-auth', 'skipped');
    service.markProgress(user.id, 'api-auth', 'explored');

    const progress = service.getUserProgress(user.id);
    expect(progress).toHaveLength(1);
    expect(progress[0].status).toBe('explored');
  });
});

describe('Notes CRUD', () => {
  test('adds and retrieves notes', () => {
    const user = service.createUser('Alice');
    const note = service.addNote(user.id, 'api-auth', 'Good overview of JWT flow');

    expect(note.id).toBeDefined();
    expect(note.content).toBe('Good overview of JWT flow');

    const notes = service.getNotes(user.id, 'api-auth');
    expect(notes).toHaveLength(1);
  });

  test('edits a note', () => {
    const user = service.createUser('Alice');
    const note = service.addNote(user.id, 'api-auth', 'Original');
    service.editNote(note.id, 'Updated content');

    const notes = service.getNotes(user.id, 'api-auth');
    expect(notes[0].content).toBe('Updated content');
  });

  test('deletes a note', () => {
    const user = service.createUser('Alice');
    const note = service.addNote(user.id, 'api-auth', 'To be deleted');
    service.deleteNote(note.id);

    const notes = service.getNotes(user.id, 'api-auth');
    expect(notes).toHaveLength(0);
  });
});

describe('Team', () => {
  test('aggregates team progress', () => {
    const alice = service.createUser('Alice');
    const bob = service.createUser('Bob');

    service.markProgress(alice.id, 'api-auth', 'explored');
    service.markProgress(alice.id, 'dashboard', 'explored');
    service.markProgress(bob.id, 'api-auth', 'explored');
    service.markProgress(bob.id, 'dashboard', 'skipped');

    const team = service.getTeam();
    expect(team).toHaveLength(2);

    const aliceMember = team.find(m => m.name === 'Alice')!;
    expect(aliceMember.exploredCount).toBe(2);

    const bobMember = team.find(m => m.name === 'Bob')!;
    expect(bobMember.exploredCount).toBe(1); // skipped doesn't count
  });
});
