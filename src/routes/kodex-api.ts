/**
 * Kodex API Routes
 *
 * REST API endpoints for Kodex knowledge management.
 */

import { getKodexManager } from '../services/kodex-manager.js';
import type { TopicContent, FlagType, FlagStatus } from '../services/kodex-manager.js';

/**
 * Handle Kodex API requests
 */
export async function handleKodexAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/kodex', '');
  const project = url.searchParams.get('project');

  if (!project) {
    return jsonError('Missing required query parameter: project', 400);
  }

  const kodex = getKodexManager(project);

  try {
    // Route by path and method
    // Topics
    if (path === '/topics' && req.method === 'GET') {
      return handleListTopics(kodex);
    }
    if (path.match(/^\/topics\/[^/]+$/) && req.method === 'GET') {
      const name = path.split('/')[2];
      return handleGetTopic(kodex, name);
    }
    if (path === '/topics' && req.method === 'POST') {
      return handleCreateTopic(kodex, req);
    }
    if (path.match(/^\/topics\/[^/]+$/) && req.method === 'PUT') {
      const name = path.split('/')[2];
      return handleUpdateTopic(kodex, name, req);
    }
    if (path.match(/^\/topics\/[^/]+$/) && req.method === 'DELETE') {
      const name = path.split('/')[2];
      return handleDeleteTopic(kodex, name);
    }
    if (path.match(/^\/topics\/[^/]+\/verify$/) && req.method === 'POST') {
      const name = path.split('/')[2];
      return handleVerifyTopic(kodex, name, req);
    }
    if (path.match(/^\/topics\/[^/]+\/flag$/) && req.method === 'POST') {
      const name = path.split('/')[2];
      return handleFlagTopic(kodex, name, req);
    }

    // Flags
    if (path === '/flags' && req.method === 'GET') {
      const status = url.searchParams.get('status') as FlagStatus | null;
      return handleListFlags(kodex, status || undefined);
    }
    if (path.match(/^\/flags\/\d+$/) && req.method === 'PUT') {
      const id = parseInt(path.split('/')[2], 10);
      return handleUpdateFlag(kodex, id, req);
    }

    // Drafts
    if (path === '/drafts' && req.method === 'GET') {
      return handleListDrafts(kodex);
    }
    if (path.match(/^\/drafts\/[^/]+\/approve$/) && req.method === 'POST') {
      const name = path.split('/')[2];
      return handleApproveDraft(kodex, name);
    }
    if (path.match(/^\/drafts\/[^/]+\/reject$/) && req.method === 'POST') {
      const name = path.split('/')[2];
      return handleRejectDraft(kodex, name);
    }

    // Dashboard
    if (path === '/dashboard' && req.method === 'GET') {
      return handleDashboard(kodex);
    }

    // Missing topics
    if (path === '/missing' && req.method === 'GET') {
      return handleMissingTopics(kodex);
    }

    return jsonError('Not found', 404);
  } catch (error) {
    console.error('[Kodex API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonError(message, 500);
  }
}

// ============================================================================
// Handlers
// ============================================================================

async function handleListTopics(kodex: ReturnType<typeof getKodexManager>): Promise<Response> {
  const topics = await kodex.listTopics();
  return Response.json(topics);
}

async function handleGetTopic(kodex: ReturnType<typeof getKodexManager>, name: string): Promise<Response> {
  const topic = await kodex.getTopic(name, true);
  if (!topic) {
    return jsonError('Topic not found', 404);
  }
  return Response.json(topic);
}

async function handleCreateTopic(kodex: ReturnType<typeof getKodexManager>, req: Request): Promise<Response> {
  const body = await req.json() as {
    name: string;
    title: string;
    content: TopicContent;
    createdBy?: string;
  };

  if (!body.name || !body.title || !body.content) {
    return jsonError('Missing required fields: name, title, content', 400);
  }

  const draft = await kodex.createTopic(body.name, body.title, body.content, body.createdBy || 'api');
  return Response.json(draft, { status: 201 });
}

async function handleUpdateTopic(kodex: ReturnType<typeof getKodexManager>, name: string, req: Request): Promise<Response> {
  const body = await req.json() as {
    content: Partial<TopicContent>;
    reason: string;
  };

  if (!body.content || !body.reason) {
    return jsonError('Missing required fields: content, reason', 400);
  }

  const draft = await kodex.updateTopic(name, body.content, body.reason);
  return Response.json(draft);
}

async function handleDeleteTopic(kodex: ReturnType<typeof getKodexManager>, name: string): Promise<Response> {
  await kodex.deleteTopic(name);
  return new Response(null, { status: 204 });
}

async function handleVerifyTopic(kodex: ReturnType<typeof getKodexManager>, name: string, req: Request): Promise<Response> {
  const body = await req.json() as { verifiedBy: string };

  if (!body.verifiedBy) {
    return jsonError('Missing required field: verifiedBy', 400);
  }

  await kodex.verifyTopic(name, body.verifiedBy);
  const topic = await kodex.getTopic(name, false);
  return Response.json(topic);
}

async function handleFlagTopic(kodex: ReturnType<typeof getKodexManager>, name: string, req: Request): Promise<Response> {
  const body = await req.json() as {
    type: FlagType;
    description: string;
  };

  if (!body.type || !body.description) {
    return jsonError('Missing required fields: type, description', 400);
  }

  const flag = await kodex.createFlag(name, body.type, body.description);
  return Response.json(flag, { status: 201 });
}

async function handleListFlags(kodex: ReturnType<typeof getKodexManager>, status?: FlagStatus): Promise<Response> {
  const flags = await kodex.listFlags(status);
  return Response.json(flags);
}

async function handleUpdateFlag(kodex: ReturnType<typeof getKodexManager>, id: number, req: Request): Promise<Response> {
  const body = await req.json() as { status: FlagStatus };

  if (!body.status) {
    return jsonError('Missing required field: status', 400);
  }

  await kodex.updateFlagStatus(id, body.status);
  return Response.json({ id, status: body.status });
}

async function handleListDrafts(kodex: ReturnType<typeof getKodexManager>): Promise<Response> {
  const drafts = await kodex.listDrafts();
  return Response.json(drafts);
}

async function handleApproveDraft(kodex: ReturnType<typeof getKodexManager>, name: string): Promise<Response> {
  const topic = await kodex.approveDraft(name);
  return Response.json(topic);
}

async function handleRejectDraft(kodex: ReturnType<typeof getKodexManager>, name: string): Promise<Response> {
  await kodex.rejectDraft(name);
  return Response.json({ message: 'Draft rejected' });
}

async function handleDashboard(kodex: ReturnType<typeof getKodexManager>): Promise<Response> {
  const stats = await kodex.getDashboardStats();
  return Response.json(stats);
}

async function handleMissingTopics(kodex: ReturnType<typeof getKodexManager>): Promise<Response> {
  const missing = await kodex.getMissingTopics();
  return Response.json(missing);
}

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
