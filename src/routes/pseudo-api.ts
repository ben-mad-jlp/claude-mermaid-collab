/**
 * Pseudo API Routes
 *
 * REST API endpoints for reading and searching .pseudo files.
 */

import { getPseudoDb } from '../services/pseudo-db.js';

/**
 * Handle Pseudo API requests
 */
export async function handlePseudoAPI(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/pseudo', '');
  const project = url.searchParams.get('project');

  if (!project) {
    return jsonError('Missing required query parameter: project', 400);
  }

  try {
    // Route by path and method
    if (path === '/files' && req.method === 'GET') {
      return handleListFiles(project);
    }

    if (path === '/file' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) {
        return jsonError('Missing required query parameter: file', 400);
      }
      return handleGetFile(project, file);
    }

    if (path === '/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      if (!query) {
        return jsonError('Missing required query parameter: q', 400);
      }
      return handleSearch(project, query);
    }

    if (path === '/references' && req.method === 'GET') {
      const functionName = url.searchParams.get('functionName');
      const fileStem = url.searchParams.get('fileStem');
      if (!functionName || !fileStem) {
        return jsonError('Missing required query parameters: functionName, fileStem', 400);
      }
      return handleGetReferences(project, functionName, fileStem);
    }

    if (path === '/graph' && req.method === 'GET') {
      return Response.json(getPseudoDb(project).getCallGraph());
    }

    if (path === '/exports' && req.method === 'GET') {
      return Response.json(getPseudoDb(project).getExports());
    }

    if (path === '/impact' && req.method === 'GET') {
      const methodName = url.searchParams.get('methodName');
      const fileStem = url.searchParams.get('fileStem');
      if (!methodName || !fileStem) {
        return jsonError('Missing required query parameters: methodName, fileStem', 400);
      }
      return Response.json(getPseudoDb(project).getImpactAnalysis(methodName, fileStem));
    }

    if (path === '/orphans' && req.method === 'GET') {
      return Response.json(getPseudoDb(project).getOrphanFunctions());
    }

    if (path === '/stale' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      return Response.json(getPseudoDb(project).getStaleFunctions(days));
    }

    if (path === '/coverage' && req.method === 'GET') {
      const directory = url.searchParams.get('directory') || undefined;
      return Response.json(getPseudoDb(project).getCoverage(directory));
    }

    if (path === '/stats' && req.method === 'GET') {
      const db = getPseudoDb(project);
      const files = db.listFiles();
      const fileCount = files.length;
      const methodCount = files.reduce((sum, f) => sum + f.methodCount, 0);
      const exportCount = files.reduce((sum, f) => sum + f.exportCount, 0);
      return Response.json({ fileCount, methodCount, exportCount });
    }

    if (path === '/directories' && req.method === 'GET') {
      const dir = url.searchParams.get('dir') || '';
      return Response.json(getPseudoDb(project).getFilesByDirectory(dir));
    }

    if (path === '/diagram' && req.method === 'GET') {
      const directory = url.searchParams.get('directory') || undefined;
      const db = getPseudoDb(project);
      const graph = db.getCallGraph();

      // Filter nodes/edges by directory if specified
      let nodes = graph.nodes;
      let edges = graph.edges;
      if (directory) {
        const nodeIds = new Set(
          nodes.filter(n => n.filePath.startsWith(directory)).map(n => n.id)
        );
        nodes = nodes.filter(n => nodeIds.has(n.id));
        edges = edges.filter(e => nodeIds.has(e.source) || nodeIds.has(e.target));
      }

      // Generate Mermaid flowchart
      const lines: string[] = ['flowchart TD'];
      for (const node of nodes) {
        const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`  ${safeId}["${node.label}"]`);
      }
      for (const edge of edges) {
        const safeSource = edge.source.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeTarget = edge.target.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`  ${safeSource} --> ${safeTarget}`);
      }

      return Response.json({ mermaid: lines.join('\n') });
    }

    return jsonError('Not found', 404);
  } catch (error) {
    console.error('[Pseudo API] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonError(message, 500);
  }
}

// ============================================================================
// Handlers
// ============================================================================

function handleListFiles(project: string): Response {
  const db = getPseudoDb(project);
  return Response.json({ files: db.listFiles() });
}

function handleGetFile(project: string, file: string): Response {
  const db = getPseudoDb(project);
  const result = db.getFile(file);
  if (!result) return jsonError('File not found', 404);
  return Response.json(result);
}

function handleSearch(project: string, query: string): Response {
  const db = getPseudoDb(project);
  return Response.json({ matches: db.search(query) });
}

function handleGetReferences(project: string, functionName: string, fileStem: string): Response {
  const db = getPseudoDb(project);
  return Response.json({ references: db.getReferences(functionName, fileStem) });
}

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
