import { readFile, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { createHash, randomUUID } from 'crypto';
import { ArtifactManager, ArtifactRecord } from './artifact-manager';
import { CodeFile, ProposedEdit } from '../types';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.cs': 'csharp',
    '.css': 'css',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
  };
  return map[ext] ?? 'plaintext';
}

export class CodeFileManager extends ArtifactManager<CodeFile> {
  constructor(basePath: string) {
    super(basePath, 'codefile');
  }

  buildRecord(id: string, content: string, lastModified: number): CodeFile {
    const parsed = JSON.parse(content);
    return { ...parsed, id, lastModified };
  }

  async createCodeFile(
    filePath: string,
    name?: string
  ): Promise<{ id: string; existed: boolean }> {
    // Scan index for existing entry with same filePath
    for (const [entryId] of this.index.entries()) {
      const record = await this.get(entryId);
      if (record?.filePath === filePath) {
        return { id: entryId, existed: true };
      }
    }

    const diskContent = await readFile(filePath, 'utf-8');
    const id = randomUUID();
    const now = Date.now();

    const record: CodeFile = {
      id,
      filePath,
      name: name ?? basename(filePath),
      content: diskContent,
      language: detectLanguage(filePath),
      contentHash: sha256(diskContent),
      dirty: false,
      linkCreatedAt: now,
      lastPushedAt: null,
      lastSyncedAt: null,
      lastModified: now,
    };

    await writeFile(
      join(this.basePath, id + '.codefile'),
      JSON.stringify(record, null, 2),
      'utf-8'
    );

    this.index.set(id, {
      name: record.name,
      path: join(this.basePath, id + '.codefile'),
      lastModified: record.lastModified,
    });

    return { id, existed: false };
  }

  private async _writeRecord(record: CodeFile): Promise<void> {
    const path = join(this.basePath, record.id + '.codefile');
    await writeFile(path, JSON.stringify(record, null, 2), 'utf-8');
    const meta = this.index.get(record.id);
    if (meta) {
      meta.lastModified = record.lastModified;
    }
  }

  async updateContent(id: string, newContent: string): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`CodeFile ${id} not found`);
    record.content = newContent;
    record.contentHash = sha256(newContent);
    record.dirty = true;
    record.lastModified = Date.now();
    await this._writeRecord(record);
  }

  async markPushed(id: string): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`CodeFile ${id} not found`);
    record.dirty = false;
    record.lastPushedAt = Date.now();
    record.contentHash = sha256(record.content);
    record.lastModified = Date.now();
    await this._writeRecord(record);
  }

  async markSynced(id: string, diskContent: string): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`CodeFile ${id} not found`);
    record.content = diskContent;
    record.contentHash = sha256(diskContent);
    record.dirty = false;
    record.lastSyncedAt = Date.now();
    record.lastModified = Date.now();
    await this._writeRecord(record);
  }

  async setProposedEdit(id: string, edit: ProposedEdit): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`CodeFile ${id} not found`);
    record.proposedEdit = edit;
    record.lastModified = Date.now();
    await this._writeRecord(record);
  }

  async clearProposedEdit(id: string): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`CodeFile ${id} not found`);
    delete record.proposedEdit;
    record.lastModified = Date.now();
    await this._writeRecord(record);
  }
}
