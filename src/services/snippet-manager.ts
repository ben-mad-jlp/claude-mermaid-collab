import type { Snippet } from '../types';
import { ArtifactManager } from './artifact-manager';
export type { ArtifactVersionEntry as SnippetVersionEntry } from './artifact-manager';

/**
 * SnippetManager handles CRUD operations and version history tracking for code snippets.
 *
 * Storage structure:
 * .collab/sessions/{name}/snippets/
 *   ├── {id}.snippet (current content)
 *   └── .history/
 *       └── {id}.history (version history JSON)
 */
export class SnippetManager extends ArtifactManager<Snippet> {
  constructor(basePath: string) {
    super(basePath, 'snippet');
  }

  buildRecord(id: string, content: string, lastModified: number): Snippet {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if ('content' in parsed) {
        // New flat format
        return {
          id,
          name: typeof parsed.name === 'string' ? parsed.name : id,
          content: typeof parsed.content === 'string' ? parsed.content : '',
          language: typeof parsed.language === 'string' ? parsed.language : '',
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          lastModified,
        };
      } else if ('code' in parsed) {
        // Old envelope format
        return {
          id,
          name: id,
          content: typeof parsed.code === 'string' ? parsed.code : '',
          language: typeof parsed.language === 'string' ? parsed.language : '',
          tags: [],
          lastModified,
        };
      }
    } catch {
      // Plain text fallback
    }
    return {
      id,
      name: id,
      content,
      language: '',
      tags: [],
      lastModified,
    };
  }

  // Backwards-compat aliases
  async getSnippet(id: string): Promise<Snippet | null> {
    return this.get(id);
  }

  async listSnippets(): Promise<Snippet[]> {
    return this.list();
  }

  async deleteSnippet(id: string): Promise<void> {
    return this.delete(id);
  }

  hasSnippet(id: string): boolean {
    return this.has(id);
  }

  async saveSnippet(id: string, rawContent: string): Promise<void> {
    return this.save(id, rawContent);
  }

  async createSnippet(name: string, content: string): Promise<string> {
    return this.create(name, content);
  }
}
