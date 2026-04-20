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
      return jsonError(
        'The /stale endpoint was retired when pseudo-db unified on V6, which does not track per-method timestamps. See the degradation ledger in pseudo-db-unification-design.',
        410,
      );
    }

    if (path === '/coverage' && req.method === 'GET') {
      const directory = url.searchParams.get('directory') || undefined;
      return Response.json(getPseudoDb(project).getCoverage(directory));
    }

    if (path === '/source-link' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      if (!name) {
        return jsonError('Missing required query parameter: name', 400);
      }
      const hintFileStem = url.searchParams.get('hintFileStem') || undefined;
      const candidates = getPseudoDb(project).getSourceLink(name, hintFileStem);
      return Response.json({ candidates });
    }

    if (path === '/functions-for-source' && req.method === 'GET') {
      const sourcePath = url.searchParams.get('sourcePath');
      if (!sourcePath) {
        return jsonError('Missing required query parameter: sourcePath', 400);
      }
      return Response.json({ functions: getPseudoDb(project).getFunctionsForSource(sourcePath) });
    }

    if (path === '/stats' && req.method === 'GET') {
      return Response.json(getPseudoDb(project).getStats());
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
  // Try exact path first, then fall back to stem lookup
  const result = db.getFile(file) || db.getFileByStem(file);
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
