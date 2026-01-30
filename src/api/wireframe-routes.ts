import { join, dirname } from 'path';
import { readdir, mkdir, writeFile, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Type definitions for wireframe handling
 */
export interface WireframeRoot {
  viewport?: string;
  direction?: string;
  screens?: any[];
  [key: string]: any;
}

export interface WireframeFile {
  id: string;
  name: string;
  content: WireframeRoot;
  lastModified: number;
}

export interface WireframeListItem {
  id: string;
  name: string;
  lastModified?: number;
}

/**
 * GET /api/wireframes - List wireframes in session
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 *
 * Response: { wireframes: WireframeListItem[] }
 */
export async function listWireframesHandler(req: any, res: any): Promise<any> {
  const { project, session } = req.query;
  const wireframesDir = join(project, '.collab', 'sessions', session, 'wireframes');

  const files = await readdir(wireframesDir).catch(() => []);

  const wireframes = files
    .filter((f) => f.endsWith('.wireframe.json'))
    .map((f) => {
      const id = f.replace('.wireframe.json', '');
      return { id, name: id };
    });

  const result = { wireframes };
  return res.json(result);
}

/**
 * POST /api/wireframe - Create new wireframe
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 *
 * Body: { name: string, content: WireframeRoot }
 *
 * Response: { id: string, success: boolean }
 */
export async function createWireframeHandler(req: any, res: any): Promise<any> {
  const { project, session } = req.query;
  const { name, content } = await req.json();

  const filePath = join(project, '.collab', 'sessions', session, 'wireframes', `${name}.wireframe.json`);

  // Create directories if they don't exist
  await mkdir(dirname(filePath), { recursive: true });

  // Write wireframe file with proper JSON formatting
  await writeFile(filePath, JSON.stringify(content, null, 2));

  const result = { id: name, success: true };
  return res.json(result);
}

/**
 * GET /api/wireframe/:id - Get wireframe by ID
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 * - id: wireframe ID (file name without extension)
 *
 * Response: { id: string, content: string, lastModified: number }
 * Note: content is returned as a JSON string for consistency with diagrams/documents
 */
export async function getWireframeHandler(req: any, res: any): Promise<any> {
  const { project, session, id } = req.query;
  const filePath = join(project, '.collab', 'sessions', session, 'wireframes', `${id}.wireframe.json`);

  try {
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Wireframe not found' });
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
  } catch (error: any) {
    return res.status(404).json({ error: 'Wireframe not found' });
  }
}

/**
 * POST /api/wireframe/:id - Update wireframe
 *
 * Query params:
 * - project: absolute path to project
 * - session: session name
 * - id: wireframe ID (file name without extension)
 *
 * Body: { content: string } - JSON string of wireframe content
 *
 * Response: { success: boolean }
 */
export async function updateWireframeHandler(req: any, res: any): Promise<any> {
  const { project, session, id } = req.query;
  const { content } = await req.json();

  const filePath = join(project, '.collab', 'sessions', session, 'wireframes', `${id}.wireframe.json`);

  try {
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Wireframe not found' });
    }

    // Content can be either a string or an object
    // If it's a string, write it directly; if object, stringify it
    const contentToWrite = typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2);

    await writeFile(filePath, contentToWrite);

    const result = { success: true };
    return res.json(result);
  } catch (error: any) {
    return res.status(404).json({ error: 'Wireframe not found' });
  }
}
