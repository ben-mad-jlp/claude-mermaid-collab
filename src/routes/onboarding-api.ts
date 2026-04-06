/**
 * Onboarding API Routes
 *
 * REST API endpoints for onboarding features:
 * - Config, directories, graph (from OnboardingManager)
 * - Search (from OnboardingDbService FTS5)
 * - Users, progress, notes, team (from OnboardingDbService)
 * - Files (from PseudoDb)
 */

import { OnboardingManager } from '../services/onboarding-manager.js';
import { OnboardingDbService } from '../services/onboarding-db.js';
import { getPseudoDb } from '../services/pseudo-db.js';

export async function handleOnboardingAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/onboarding', '');
  const project = url.searchParams.get('project');

  if (!project) {
    return jsonError('Missing required query parameter: project', 400);
  }

  const manager = new OnboardingManager(project);
  const dbService = new OnboardingDbService(project);

  try {
    // ---- OnboardingManager routes ----

    if (path === '/config' && req.method === 'GET') {
      const config = manager.getConfig();
      return Response.json(config);
    }

    if (path === '/directories' && req.method === 'GET') {
      const directories = manager.getCategories();
      return Response.json(directories);
    }

    if (path === '/graph' && req.method === 'GET') {
      const graph = manager.getGraph();
      return Response.json(graph);
    }

    // Files (delegate to pseudo-db)
    if (path === '/files' && req.method === 'GET') {
      const db = getPseudoDb(project);
      const files = db.listFiles();
      return Response.json(files);
    }

    if (path.startsWith('/files/') && req.method === 'GET') {
      const filePath = path.slice('/files/'.length);
      const db = getPseudoDb(project);
      const file = db.getFile(filePath);
      if (!file) {
        return jsonError('File not found', 404);
      }
      return Response.json(file);
    }

    // ---- Search ----

    if (path === '/search' && req.method === 'GET') {
      const q = url.searchParams.get('q');
      if (!q) {
        return jsonError('Missing required query parameter: q', 400);
      }
      const scopeParam = url.searchParams.get('scope');
      const scope = scopeParam ? scopeParam.split(',') : undefined;
      const results = dbService.search(q, scope);
      return Response.json(results);
    }

    // ---- Users ----

    if (path === '/users' && req.method === 'GET') {
      const users = dbService.listUsers();
      return Response.json(users);
    }

    if (path === '/users' && req.method === 'POST') {
      const body = await req.json() as { name: string };
      if (!body.name?.trim()) {
        return jsonError('Missing required field: name', 400);
      }
      try {
        const user = dbService.createUser(body.name.trim());
        return Response.json(user, { status: 201 });
      } catch (e: any) {
        if (e.message?.includes('UNIQUE constraint')) {
          return jsonError('User with this name already exists', 409);
        }
        throw e;
      }
    }

    if (path.match(/^\/users\/\d+$/) && req.method === 'GET') {
      const id = parseInt(path.split('/')[2], 10);
      const user = dbService.getUser(id);
      if (!user) {
        return jsonError('User not found', 404);
      }
      return Response.json(user);
    }

    // ---- Progress ----

    if (path.match(/^\/progress\/\d+$/) && req.method === 'GET') {
      const userId = parseInt(path.split('/')[2], 10);
      const progress = dbService.getUserProgress(userId);
      return Response.json(progress);
    }

    if (path.match(/^\/progress\/\d+\/.+/) && req.method === 'POST') {
      const match = path.match(/^\/progress\/(\d+)\/(.+)$/);
      if (!match) return jsonError('Invalid path', 400);
      const userId = parseInt(match[1], 10);
      const filePath = decodeURIComponent(match[2]);
      const body = await req.json() as { status: 'explored' | 'skipped' };
      if (!body.status || !['explored', 'skipped'].includes(body.status)) {
        return jsonError('Missing or invalid field: status (explored | skipped)', 400);
      }
      dbService.markProgress(userId, filePath, body.status);
      return Response.json({ ok: true, filePath });
    }

    if (path.match(/^\/progress\/\d+\/.+/) && req.method === 'DELETE') {
      const match = path.match(/^\/progress\/(\d+)\/(.+)$/);
      if (!match) return jsonError('Invalid path', 400);
      const userId = parseInt(match[1], 10);
      const filePath = decodeURIComponent(match[2]);
      dbService.deleteProgress(userId, filePath);
      return new Response(null, { status: 204 });
    }

    // ---- Notes ----

    if (path.match(/^\/notes\/\d+\/.+/) && req.method === 'GET') {
      const match = path.match(/^\/notes\/(\d+)\/(.+)$/);
      if (!match) return jsonError('Invalid path', 400);
      const userId = parseInt(match[1], 10);
      const filePath = decodeURIComponent(match[2]);
      const notes = dbService.getNotes(userId, filePath);
      return Response.json(notes);
    }

    if (path.match(/^\/notes\/\d+\/.+/) && req.method === 'POST') {
      const match = path.match(/^\/notes\/(\d+)\/(.+)$/);
      if (!match) return jsonError('Invalid path', 400);
      const userId = parseInt(match[1], 10);
      const filePath = decodeURIComponent(match[2]);
      const body = await req.json() as { content: string };
      if (!body.content?.trim()) {
        return jsonError('Missing required field: content', 400);
      }
      const note = dbService.addNote(userId, filePath, body.content.trim());
      return Response.json(note, { status: 201 });
    }

    if (path.match(/^\/notes\/\d+$/) && req.method === 'PUT') {
      const noteId = parseInt(path.split('/')[2], 10);
      const body = await req.json() as { content: string };
      if (!body.content?.trim()) {
        return jsonError('Missing required field: content', 400);
      }
      dbService.editNote(noteId, body.content.trim());
      return Response.json({ ok: true });
    }

    if (path.match(/^\/notes\/\d+$/) && req.method === 'DELETE') {
      const noteId = parseInt(path.split('/')[2], 10);
      dbService.deleteNote(noteId);
      return new Response(null, { status: 204 });
    }

    // ---- Team ----

    if (path === '/team' && req.method === 'GET') {
      const team = dbService.getTeam();
      return Response.json(team);
    }

    return jsonError('Not found', 404);
  } catch (error) {
    console.error('[Onboarding API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonError(message, 500);
  } finally {
    dbService.close();
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
