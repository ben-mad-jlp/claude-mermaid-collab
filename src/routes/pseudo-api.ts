/**
 * Pseudo API Routes
 *
 * REST API endpoints for reading and searching .pseudo files.
 */

import { join, relative } from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';

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
      return await handleListFiles(project);
    }

    if (path === '/file' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (!file) {
        return jsonError('Missing required query parameter: file', 400);
      }
      return await handleGetFile(project, file);
    }

    if (path === '/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      if (!query) {
        return jsonError('Missing required query parameter: q', 400);
      }
      return await handleSearch(project, query);
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

/**
 * List all .pseudo files in the project
 * Returns file stems (without .pseudo extension), sorted alphabetically
 */
async function handleListFiles(project: string): Promise<Response> {
  const files: string[] = [];

  try {
    // Recursively walk the filesystem to find all .pseudo files
    async function walkDir(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.pseudo')) {
          // Calculate relative path from project root
          const relativePath = relative(project, fullPath);
          // Strip .pseudo extension
          const stem = relativePath.replace(/\.pseudo$/, '');
          files.push(stem);
        }
      }
    }

    await walkDir(project);

    // Sort alphabetically
    files.sort();

    return Response.json({ files });
  } catch (error) {
    console.error('[Pseudo API] Error listing files:', error);
    // Even if there's an error, return empty list (directory may not exist yet)
    return Response.json({ files: [] });
  }
}

/**
 * Get content of a single .pseudo file
 */
async function handleGetFile(project: string, file: string): Promise<Response> {
  try {
    // Construct path: append .pseudo extension if not already present
    const filePath = file.endsWith('.pseudo') ? file : `${file}.pseudo`;
    const fullPath = join(project, filePath);

    // Check if file exists
    if (!existsSync(fullPath)) {
      return jsonError('File not found', 404);
    }

    // Read file content
    const content = await readFile(fullPath, 'utf-8');

    return Response.json({
      content,
      path: fullPath,
    });
  } catch (error) {
    console.error('[Pseudo API] Error reading file:', error);
    const message = error instanceof Error ? error.message : 'Failed to read file';
    return jsonError(message, 500);
  }
}

/**
 * Search for query in all .pseudo files
 * Returns matches grouped by file, sorted with FUNCTION line matches first
 */
async function handleSearch(project: string, query: string): Promise<Response> {
  const matches: Record<string, SearchMatch[]> = {};
  let totalMatches = 0;
  const MAX_MATCHES = 50;

  try {
    const queryLower = query.toLowerCase();

    // Recursively walk the filesystem to find all .pseudo files
    async function walkDir(dir: string): Promise<void> {
      if (totalMatches >= MAX_MATCHES) return;

      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (totalMatches >= MAX_MATCHES) break;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.pseudo')) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            let currentFunction: string | null = null;
            const fileMatches: SearchMatch[] = [];

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
              if (totalMatches >= MAX_MATCHES) break;

              const line = lines[lineNum];
              const lineLower = line.toLowerCase();

              // Track current FUNCTION name
              if (lineLower.startsWith('function ')) {
                const match = line.match(/^function\s+(\w+)/i);
                if (match) {
                  currentFunction = match[1];
                }
              }

              // Check if line matches query
              if (lineLower.includes(queryLower)) {
                const isFunctionLine = lineLower.startsWith('function ');
                fileMatches.push({
                  line: line.trim(),
                  lineNumber: lineNum + 1,
                  isFunctionLine,
                  functionName: currentFunction,
                });
                totalMatches++;
              }
            }

            // Sort: FUNCTION line matches first, then body matches
            fileMatches.sort((a, b) => {
              if (a.isFunctionLine !== b.isFunctionLine) {
                return a.isFunctionLine ? -1 : 1;
              }
              return a.lineNumber - b.lineNumber;
            });

            if (fileMatches.length > 0) {
              // Calculate relative path from project root and strip .pseudo extension
              const relativePath = relative(project, fullPath);
              const fileKey = relativePath.replace(/\.pseudo$/, '');
              matches[fileKey] = fileMatches;
            }
          } catch (fileError) {
            console.error(`[Pseudo API] Error reading file ${fullPath}:`, fileError);
            // Continue with next file
          }
        }
      }
    }

    await walkDir(project);

    return Response.json({ matches });
  } catch (error) {
    console.error('[Pseudo API] Error searching files:', error);
    // Return empty matches on error
    return Response.json({ matches: {} });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// Type definitions for search results
interface SearchMatch {
  line: string;
  lineNumber: number;
  isFunctionLine: boolean;
  functionName: string | null;
}
