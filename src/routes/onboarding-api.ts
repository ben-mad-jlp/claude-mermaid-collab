/**
 * Onboarding API Routes
 *
 * REST API endpoints for Kodex onboarding features:
 * - Config, categories, graph, diagrams (from OnboardingManager)
 * - Search (from OnboardingDbService FTS5)
 * - Users, progress, notes, team (from OnboardingDbService)
 * - Topics (delegates to KodexManager)
 */

import { OnboardingManager } from '../services/onboarding-manager.js';
import { OnboardingDbService } from '../services/onboarding-db.js';
import { getKodexManager } from '../services/kodex-manager.js';

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
      const config = await manager.getConfig();
      return Response.json(config);
    }

    if (path === '/categories' && req.method === 'GET') {
      const categories = await manager.getCategories();
      return Response.json(categories);
    }

    if (path === '/graph' && req.method === 'GET') {
      const graph = await manager.getGraph();
      return Response.json(graph);
    }

    // Topics (delegate to kodex manager)
    if (path === '/topics' && req.method === 'GET') {
      const kodex = getKodexManager(project);
      const topics = await kodex.listTopics();
      return Response.json(topics);
    }

    if (path.match(/^\/topics\/[^/]+$/) && req.method === 'GET') {
      const name = path.split('/')[2];
      const kodex = getKodexManager(project);
      const topic = await kodex.getTopic(name, true);
      if (!topic) {
        return jsonError('Topic not found', 404);
      }
      return Response.json(topic);
    }

    if (path.match(/^\/topics\/[^/]+\/diagram$/) && req.method === 'GET') {
      const name = path.split('/')[2];
      const diagrams = await manager.getDiagram(name);
      return Response.json(diagrams);
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

    if (path.match(/^\/progress\/\d+\/[^/]+$/) && req.method === 'POST') {
      const parts = path.split('/');
      const userId = parseInt(parts[2], 10);
      const topic = parts[3];
      const body = await req.json() as { status: 'explored' | 'skipped' };
      if (!body.status || !['explored', 'skipped'].includes(body.status)) {
        return jsonError('Missing or invalid field: status (explored | skipped)', 400);
      }
      dbService.markProgress(userId, topic, body.status);
      return Response.json({ ok: true });
    }

    if (path.match(/^\/progress\/\d+\/[^/]+$/) && req.method === 'DELETE') {
      const parts = path.split('/');
      const userId = parseInt(parts[2], 10);
      const topic = parts[3];
      dbService.deleteProgress(userId, topic);
      return new Response(null, { status: 204 });
    }

    // ---- Notes ----

    if (path.match(/^\/notes\/\d+\/[^/]+$/) && req.method === 'GET') {
      const parts = path.split('/');
      const userId = parseInt(parts[2], 10);
      const topic = parts[3];
      const notes = dbService.getNotes(userId, topic);
      return Response.json(notes);
    }

    if (path.match(/^\/notes\/\d+\/[^/]+$/) && req.method === 'POST') {
      const parts = path.split('/');
      const userId = parseInt(parts[2], 10);
      const topic = parts[3];
      const body = await req.json() as { content: string };
      if (!body.content?.trim()) {
        return jsonError('Missing required field: content', 400);
      }
      const note = dbService.addNote(userId, topic, body.content.trim());
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
