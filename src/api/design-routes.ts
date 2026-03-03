import { join, dirname } from 'path';
import { readdir, mkdir, writeFile, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Sanitize a design ID/name to prevent path traversal attacks.
 * Only allows alphanumeric, hyphens, underscores, dots, and spaces.
 */
function sanitizeDesignId(id: string): string | null {
  if (!id || typeof id !== 'string') return null;
  // Only allow alphanumeric, hyphens, underscores, and dots (no path separators)
  const sanitized = id.replace(/[^a-zA-Z0-9_\-. ]/g, '')
  if (!sanitized || sanitized !== id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return null
  }
  return sanitized
}

/**
 * Type definitions for design handling
 */
export interface DesignRoot {
  [key: string]: any;
}

export interface DesignFile {
  id: string;
  name: string;
  content: DesignRoot;
  lastModified: number;
}

export interface DesignListItem {
  id: string;
  name: string;
  lastModified?: number;
}

/**
 * GET /api/designs - List designs in session
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 *
 * Response: { designs: DesignListItem[] }
 */
export async function listDesignsHandler(req: any, res: any): Promise<any> {
  const { project, session } = req.query;
  const designsDir = join(project, '.collab', 'sessions', session, 'designs');

  const files = await readdir(designsDir).catch(() => []);

  const designs: DesignListItem[] = [];
  for (const file of files) {
    if (!file.endsWith('.design.json')) continue;
    const id = file.replace('.design.json', '');
    // Read the file to get modification time
    const fileStat = await stat(join(designsDir, file)).catch(() => null);
    designs.push({
      id,
      name: id,
      lastModified: fileStat?.mtimeMs,
    });
  }

  const result = { designs };
  return res.json(result);
}

/**
 * POST /api/design - Create new design
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 *
 * Body: { name: string, content: DesignRoot }
 *
 * Response: { id: string, success: boolean }
 */
export async function createDesignHandler(req: any, res: any): Promise<any> {
  const { project, session } = req.query;
  const { name: rawName, content } = await req.json();

  const name = sanitizeDesignId(rawName);
  if (!name) return res.status(400).json({ error: 'Invalid design name' });

  const filePath = join(project, '.collab', 'sessions', session, 'designs', `${name}.design.json`);

  // Create directories if they don't exist
  await mkdir(dirname(filePath), { recursive: true });

  // Content can be either a string or an object
  // If it's a string, write it directly; if object, stringify it
  const contentToWrite = typeof content === 'string'
    ? content
    : JSON.stringify(content, null, 2);
  await writeFile(filePath, contentToWrite);

  const result = { id: name, success: true };
  return res.json(result);
}

/**
 * GET /api/design/:id - Get design by ID
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 * - id: design ID (file name without extension)
 *
 * Response: { id: string, content: string, lastModified: number }
 * Note: content is returned as a JSON string for consistency with diagrams/documents
 */
export async function getDesignHandler(req: any, res: any): Promise<any> {
  const id = sanitizeDesignId(req.query.id as string);
  if (!id) return res.status(400).json({ error: 'Invalid design ID' });

  const { project, session } = req.query;
  const filePath = join(project, '.collab', 'sessions', session, 'designs', `${id}.design.json`);

  try {
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Design not found' });
    }

    const content = await readFile(filePath, 'utf-8');

    // Get file stats for lastModified
    const stats = await stat(filePath);
    const lastModified = stats.mtimeMs;

    // Return content as string (not parsed) for consistency with diagrams/documents
    const result = {
      id,
      content,
      lastModified,
    };
    return res.json(result);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code;
    if (code === 'ENOENT') {
      return res.status(404).json({ error: 'Design not found' });
    }
    return res.status(500).json({ error: 'Failed to get design' });
  }
}

/**
 * POST /api/design/:id - Update design
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 * - id: design ID (file name without extension)
 *
 * Body: { content: string } - JSON string of design content
 *
 * Response: { success: boolean }
 */
export async function updateDesignHandler(req: any, res: any): Promise<any> {
  const id = sanitizeDesignId(req.query.id as string);
  if (!id) return res.status(400).json({ error: 'Invalid design ID' });

  const { project, session } = req.query;
  const { content } = await req.json();

  const filePath = join(project, '.collab', 'sessions', session, 'designs', `${id}.design.json`);

  try {
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Design not found' });
    }

    // Content can be either a string or an object
    // If it's a string, write it directly; if object, stringify it
    const contentToWrite = typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2);

    await writeFile(filePath, contentToWrite);

    const result = { success: true };
    return res.json(result);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code;
    if (code === 'ENOENT') {
      return res.status(404).json({ error: 'Design not found' });
    }
    return res.status(500).json({ error: 'Failed to update design' });
  }
}
