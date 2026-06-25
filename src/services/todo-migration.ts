import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createTodo, type TodoLink } from './todo-store';

/**
 * One-time, idempotent migration of the legacy per-session todo files
 * (`<project>/.collab/sessions/<session>/session-todos.json`) into the new
 * per-project todo-store. Stamps ownerSession = assigneeSession = <session>,
 * maps completed→status, records a legacy-id→uuid sidecar, and renames the
 * source so it never re-runs.
 */

interface LegacyTodo {
  id: number;
  text: string;
  completed: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
  link?: TodoLink;
}
interface LegacyFile {
  todos: LegacyTodo[];
  nextId: number;
}

export async function migrateProject(project: string): Promise<{ migrated: number }> {
  const sessionsDir = join(project, '.collab', 'sessions');
  if (!existsSync(sessionsDir)) return { migrated: 0 };

  let migrated = 0;
  let sessions: string[];
  try {
    sessions = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { migrated: 0 };
  }

  for (const session of sessions) {
    const src = join(sessionsDir, session, 'session-todos.json');
    const migratedMarker = `${src}.migrated`;
    const sidecar = join(sessionsDir, session, 'session-todos.migrated.json');
    // Idempotent: skip if already migrated.
    if (!existsSync(src) || existsSync(migratedMarker) || existsSync(sidecar)) continue;

    let parsed: LegacyFile;
    try {
      parsed = JSON.parse(readFileSync(src, 'utf-8')) as LegacyFile;
    } catch {
      continue; // unreadable/corrupt — leave it for manual inspection
    }
    const todos = [...(parsed.todos ?? [])].sort((a, b) => a.order - b.order);
    const legacyMap: Record<number, string> = {};
    for (const old of todos) {
      const created = await createTodo(project, {
        ownerSession: session,
        assigneeSession: session,
        title: old.text,
        status: old.completed ? 'done' : 'todo',
        // Legacy import predates every-todo-needs-an-epic — preserve structure verbatim,
        // never reject/auto-home during migration.
        allowOrphan: true,
        link: old.link ?? null,
      });
      legacyMap[old.id] = created.id;
      migrated += 1;
    }

    writeFileSync(
      sidecar,
      JSON.stringify({ session, migratedAt: new Date().toISOString(), legacyMap }, null, 2)
    );
    renameSync(src, migratedMarker);
  }

  return { migrated };
}
