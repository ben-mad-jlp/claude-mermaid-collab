import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  startDocDropbox,
  dropDocName,
  isSizeStable,
  shouldStartDocDropbox,
  type DocDropboxHandle,
} from '../doc-dropbox';
import { DocumentManager } from '../document-manager';

describe('doc-dropbox', () => {
  const cleanupDirs: string[] = [];
  const handles: DocDropboxHandle[] = [];

  afterEach(async () => {
    for (const handle of handles.splice(0)) {
      await handle.close();
    }
    for (const dir of cleanupDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('dropDocName derives from-<stem>-<name> when no owner given', () => {
    expect(dropDocName('/tmp/inbox/report.md')).toBe('from-report-report');
  });

  test('dropDocName uses the owner when provided', () => {
    expect(dropDocName('/tmp/inbox/alice/report.md', 'alice')).toBe('from-alice-report');
  });

  test('shouldStartDocDropbox is gated on a non-empty dir', () => {
    expect(shouldStartDocDropbox('')).toBe(false);
    expect(shouldStartDocDropbox('/var/lib/mermaid-collab/inbox')).toBe(true);
  });

  test('imports a stable .md file and moves it to processed/', async () => {
    const dropDir = await mkdtemp(join(tmpdir(), 'doc-dropbox-drop-'));
    const docsDir = await mkdtemp(join(tmpdir(), 'doc-dropbox-docs-'));
    cleanupDirs.push(dropDir, docsDir);

    const documentManager = new DocumentManager(docsDir);
    await documentManager.initialize();

    const debounceMs = 300;
    const handle = startDocDropbox({ dropDir, documentManager, sessionLabel: 'default', debounceMs });
    handles.push(handle);
    await handle.whenReady();

    await writeFile(join(dropDir, 'hello.md'), '# Hello\n\nContent here.', 'utf-8');

    await waitFor(async () => {
      const docs = await documentManager.listDocuments();
      return docs.some((d) => d.name === 'from-hello-hello');
    }, debounceMs + 2000);

    const docs = await documentManager.listDocuments();
    expect(docs.some((d) => d.name === 'from-hello-hello')).toBe(true);

    await waitFor(async () => {
      const { readdir } = await import('fs/promises');
      const processed = await readdir(join(dropDir, 'processed'));
      return processed.includes('hello.md');
    }, 2000);
  }, 10000);

  test('does not import a partially written file before it stabilizes', async () => {
    const dropDir = await mkdtemp(join(tmpdir(), 'doc-dropbox-drop-'));
    const docsDir = await mkdtemp(join(tmpdir(), 'doc-dropbox-docs-'));
    cleanupDirs.push(dropDir, docsDir);

    const documentManager = new DocumentManager(docsDir);
    await documentManager.initialize();

    const debounceMs = 1000;
    const handle = startDocDropbox({ dropDir, documentManager, sessionLabel: 'default', debounceMs });
    handles.push(handle);
    await handle.whenReady();

    const filePath = join(dropDir, 'partial.md');
    await writeFile(filePath, '# Part 1\n', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, debounceMs / 3));
    await writeFile(filePath, '# Part 1\n\n# Part 2\n', { flag: 'a', encoding: 'utf-8' } as any);

    // Immediately after the second write, well before the debounce window elapses,
    // no document should have been created yet.
    const docsEarly = await documentManager.listDocuments();
    expect(docsEarly.some((d) => d.name === 'from-partial-partial')).toBe(false);

    await waitFor(async () => {
      const docs = await documentManager.listDocuments();
      return docs.some((d) => d.name === 'from-partial-partial');
    }, debounceMs + 3000);

    const docs = await documentManager.listDocuments();
    expect(docs.some((d) => d.name === 'from-partial-partial')).toBe(true);
  }, 10000);

  test('isSizeStable reports true when file size is unchanged across the window', async () => {
    const dropDir = await mkdtemp(join(tmpdir(), 'doc-dropbox-stable-'));
    cleanupDirs.push(dropDir);
    const filePath = join(dropDir, 'stable.md');
    await writeFile(filePath, 'unchanging content', 'utf-8');

    const stable = await isSizeStable(filePath, 50);
    expect(stable).toBe(true);
  });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}
