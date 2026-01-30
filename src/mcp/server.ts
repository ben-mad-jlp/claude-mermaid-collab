#!/usr/bin/env bun
/**
 * MCP Server for Mermaid Diagram Management (stdio transport)
 *
 * This is the legacy stdio transport server, kept for backwards compatibility.
 * For new installations, use the HTTP transport via the API server.
 *
 * NOTE: This server expects the HTTP API server to already be running.
 * Run `npm run dev` or `bun run src/server.ts` first.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMCPServer } from './setup.js';

// Version is synced with package.json via npm version command
const SERVER_VERSION = '5.40.19';

async function main() {
  // Check if API server is running
  const API_PORT = parseInt(process.env.PORT || '3737', 10);
  const API_HOST = process.env.HOST || 'localhost';
  const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      console.error(`API server not healthy at ${API_BASE_URL}`);
      console.error('Start the server first with: npm run dev');
      process.exit(1);
    }
  } catch {
    console.error(`API server not running at ${API_BASE_URL}`);
    console.error('Start the server first with: npm run dev');
    process.exit(1);
  }

  const server = await setupMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Mermaid Server v${SERVER_VERSION} running on stdio`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
