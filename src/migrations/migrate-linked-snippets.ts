import { readdir, readFile, writeFile, mkdir, copyFile, unlink } from 'fs/promises';
import * as fs from 'fs';
import { join, relative, extname, basename } from 'path';
import { createHash, randomUUID } from 'crypto';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.css': 'css', '.html': 'html',
    '.json': 'json', '.md': 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

function resolveSessionDir(project: string, session: string): string {
  const candidates = [
    join(project, '.collab', 'sessions', session),
    join(project, '.collab', 'todos', session),
    join(project, '.collab', session),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]; // default to standard path
}

export async function migrateLinkedSnippets(project: string, session: string): Promise<void> {
  const sessionDir = resolveSessionDir(project, session);
  const snippetsDir = join(sessionDir, 'snippets');
  const codeFilesDir = join(sessionDir, 'code-files');
  const backupDir = join(snippetsDir, '.migration-backup');
  const sentinelPath = join(sessionDir, '.migrated-code-files');

  if (fs.existsSync(sentinelPath)) {
    console.log('[migrate] already migrated, skipping');
    return;
  }

  if (!fs.existsSync(snippetsDir)) {
    await writeFile(sentinelPath, new Date().toISOString(), 'utf-8');
    return;
  }

  await mkdir(codeFilesDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  const files = (await readdir(snippetsDir)).filter(
    f => f.endsWith('.snippet') && !f.startsWith('.')
  );

  for (const snippetFile of files) {
    const id = basename(snippetFile, '.snippet');
    const snippetPath = join(snippetsDir, snippetFile);
    try {
      const raw = await readFile(snippetPath, 'utf-8');
      let envelope: any;
      try { envelope = JSON.parse(raw); } catch { envelope = null; }

      if (envelope?.linked === true) {
        // Branch A: linked snippet → code file
        await copyFile(snippetPath, join(backupDir, snippetFile));
        const content = envelope.code ?? '';
        const record = {
          id,
          filePath: envelope.filePath ?? '',
          name: basename(envelope.filePath ?? id),
          content,
          language: envelope.language ?? detectLanguage(envelope.filePath ?? ''),
          contentHash: sha256(content),
          dirty: envelope.dirty ?? false,
          linkCreatedAt: envelope.linkCreatedAt ?? Date.now(),
          lastPushedAt: envelope.lastPushedAt ?? null,
          lastSyncedAt: envelope.lastSyncedAt ?? null,
          lastModified: Date.now(),
        };
        await writeFile(join(codeFilesDir, `${id}.codefile`), JSON.stringify(record, null, 2), 'utf-8');
        await unlink(snippetPath);
        console.log('[migrate] linked→codefile', id);
      } else if (envelope && typeof envelope.filePath === 'string' && envelope.filePath) {
        // Branch B: has filePath but not linked → add file tag
        const flat = {
          name: basename(envelope.filePath),
          content: envelope.code ?? '',
          language: envelope.language ?? detectLanguage(envelope.filePath),
          tags: [{ type: 'file', value: relative(project, envelope.filePath) }],
        };
        await writeFile(snippetPath, JSON.stringify(flat, null, 2), 'utf-8');
        console.log('[migrate] flat+tag', id);
      } else if (envelope && typeof envelope.code === 'string' && !('content' in envelope)) {
        // Branch C: old envelope with code field → flat format
        const flat = {
          name: id,
          content: envelope.code ?? '',
          language: envelope.language ?? '',
          tags: [],
        };
        await writeFile(snippetPath, JSON.stringify(flat, null, 2), 'utf-8');
        console.log('[migrate] flat (rewrite)', id);
      }
      // else: already flat format or plain text — skip
    } catch (err) {
      console.error('[migrate] skipping', id, err);
    }
  }

  await writeFile(sentinelPath, new Date().toISOString(), 'utf-8');
  console.log('[migrate] done');
}
