#!/usr/bin/env bun
/**
 * MCP Server for Mermaid Diagram Management
 *
 * Provides MCP tools for interacting with the Mermaid collaboration server.
 * Auto-starts the web server if not running and provides 6 core tools for
 * diagram management, validation, and preview.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configuration
const API_PORT = parseInt(process.env.PORT || '3737', 10);
const API_HOST = process.env.HOST || 'localhost';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * Check if the web server is running by attempting an HTTP request
 */
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/diagrams`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 404; // Either works or exists but route not found
  } catch {
    return false;
  }
}

/**
 * Start the web server using Bun.spawn
 */
async function startWebServer(): Promise<void> {
  const serverPath = new URL('../server.ts', import.meta.url).pathname;

  console.error(`Starting web server: ${serverPath}`);

  const proc = Bun.spawn(['bun', 'run', serverPath], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'ignore',
  });

  // Wait a bit for server to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify it started
  let attempts = 0;
  while (attempts < 10) {
    if (await isServerRunning()) {
      console.error(`Web server started successfully on ${API_BASE_URL}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;
  }

  throw new Error('Failed to start web server after 10 attempts');
}

/**
 * Ensure the web server is running before processing requests
 */
async function ensureServerRunning(): Promise<void> {
  if (!(await isServerRunning())) {
    await startWebServer();
  }
}

/**
 * MCP Tool: list_diagrams
 * Lists all available diagrams
 */
async function listDiagrams(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/diagrams`);

  if (!response.ok) {
    throw new Error(`Failed to list diagrams: ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

/**
 * MCP Tool: get_diagram
 * Retrieves a specific diagram by ID
 */
async function getDiagram(id: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/diagram/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

/**
 * MCP Tool: create_diagram
 * Creates a new diagram with the given name and content
 */
async function createDiagram(name: string, content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/diagram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create diagram: ${error.error || response.statusText}`);
  }

  const data = await response.json();

  // Return the ID and URL for preview
  const previewUrl = `${API_BASE_URL}/diagram.html?id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Diagram created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

/**
 * MCP Tool: update_diagram
 * Updates an existing diagram's content
 */
async function updateDiagram(id: string, content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/diagram/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update diagram: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify({
    success: true,
    id,
    message: `Diagram updated successfully`,
  }, null, 2);
}

/**
 * MCP Tool: validate_diagram
 * Validates Mermaid diagram syntax
 */
async function validateDiagram(content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Failed to validate diagram: ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

/**
 * MCP Tool: preview_diagram
 * Returns the preview URL for a diagram
 */
async function previewDiagram(id: string): Promise<string> {
  // First verify the diagram exists
  const response = await fetch(`${API_BASE_URL}/api/diagram/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Diagram not found: ${id}`);
    }
    throw new Error(`Failed to get diagram: ${response.statusText}`);
  }

  const previewUrl = `${API_BASE_URL}/diagram.html?id=${id}`;
  return JSON.stringify({
    id,
    previewUrl,
    message: `Open this URL in your browser to view the diagram: ${previewUrl}`,
  }, null, 2);
}

/**
 * MCP Tool: list_documents
 * Lists all available documents
 */
async function listDocuments(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/documents`);

  if (!response.ok) {
    throw new Error(`Failed to list documents: ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

/**
 * MCP Tool: get_document
 * Retrieves a specific document by ID
 */
async function getDocument(id: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/document/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }

  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

/**
 * MCP Tool: create_document
 * Creates a new document with the given name and content
 */
async function createDocument(name: string, content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create document: ${error.error || response.statusText}`);
  }

  const data = await response.json();

  const previewUrl = `${API_BASE_URL}/document.html?id=${data.id}`;
  return JSON.stringify({
    success: true,
    id: data.id,
    previewUrl,
    message: `Document created successfully. View at: ${previewUrl}`,
  }, null, 2);
}

/**
 * MCP Tool: update_document
 * Updates an existing document's content
 */
async function updateDocument(id: string, content: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/document/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update document: ${error.error || response.statusText}`);
  }

  return JSON.stringify({
    success: true,
    id,
    message: `Document updated successfully`,
  }, null, 2);
}

/**
 * MCP Tool: preview_document
 * Returns the preview URL for a document
 */
async function previewDocument(id: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/document/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${id}`);
    }
    throw new Error(`Failed to get document: ${response.statusText}`);
  }

  const previewUrl = `${API_BASE_URL}/document.html?id=${id}`;
  return JSON.stringify({
    id,
    previewUrl,
    message: `Open this URL in your browser to view the document: ${previewUrl}`,
  }, null, 2);
}

/**
 * MCP Tool: transpile_diagram
 * Returns the transpiled Mermaid output for a SMACH diagram
 */
async function transpileDiagram(id: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/transpile/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to transpile diagram: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  return data.mermaid;
}

/**
 * Main MCP server setup
 */
async function main() {
  // Ensure server is running before setting up MCP
  await ensureServerRunning();

  const server = new Server(
    {
      name: 'mermaid-diagram-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Get the docs directory path
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const docsDir = join(__dirname, '..', '..', 'docs');

  // Register resources list handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'wireframe://syntax-guide',
          name: 'Wireframe Diagram Syntax Guide',
          description: 'Complete syntax reference for creating wireframe diagrams with the mermaid-wireframe plugin',
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  // Register resource read handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'wireframe://syntax-guide') {
      const content = await readFile(join(docsDir, 'wireframe-syntax.md'), 'utf-8');
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_diagrams',
          description: 'List all Mermaid diagrams. Returns diagram IDs, names, and metadata. Use this first to discover what diagrams exist before reading or updating them.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_diagram',
          description: 'Read a diagram\'s full Mermaid source code by ID. Use list_diagrams first to find available diagram IDs. Returns the content you can modify and pass to update_diagram.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The diagram ID (without .mmd extension)',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'create_diagram',
          description: `Create a new Mermaid diagram with the given name and content. Returns the diagram ID and preview URL.

=== FLOWCHART/STATE DIAGRAM STANDARDS ===

FORMATTING:
1. All node definitions at the top with their labels and shapes
2. Connections use only node IDs (no inline labels)
3. Styles at the bottom, one per node based on its type
4. Use %% comments to separate sections

NODE TYPES:
- Terminal (Start/End): NodeId(["label"]) - green: fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
- State: NodeId(("label")) - blue: fill:#bbdefb,stroke:#1976d2,stroke-width:2px
- Decision: NodeId{"label"} - yellow: fill:#fff9c4,stroke:#f9a825,stroke-width:2px
- Action: NodeId["label"] - orange: fill:#ffe0b2,stroke:#f57c00,stroke-width:2px

FLOWCHART EXAMPLE:
graph TD
    %% Node Definitions
    Start(["Start Application"])
    CheckAuth{"User Authenticated?"}
    Login["Show Login Form"]
    Dashboard(("Dashboard"))

    %% Connections
    Start --> CheckAuth
    CheckAuth -->|Yes| Dashboard
    CheckAuth -->|No| Login
    Login --> CheckAuth

    %% Styles
    style Start fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style CheckAuth fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    style Login fill:#ffe0b2,stroke:#f57c00,stroke-width:2px
    style Dashboard fill:#bbdefb,stroke:#1976d2,stroke-width:2px

=== WIREFRAME DIAGRAM SYNTAX ===

Use wireframes to create UI mockups. Start with "wireframe" followed by optional viewport and direction.

DECLARATION: wireframe [viewport] [direction]
- viewport: mobile (375px), tablet (768px), desktop (1200px), or omit for default (800px)
- direction: TD (top-down screens) or LR (left-right screens, default)

CONTAINERS (use indentation for nesting):
- screen "Label" - Screen container with dashed border and label
- col - Vertical layout (children stack vertically)
- row - Horizontal layout (children side by side)
- Card - Card with rounded border
- Grid - Table with header/rows

WIDGETS (labels in quotes):
- Text "content" - Normal text
- Title "heading" - Large heading text
- Button "label" - Button (add: primary, secondary, danger, success, disabled)
- Input "placeholder" - Text input field
- Checkbox "label" - Checkbox with label
- Radio "label" - Radio button with label
- Switch "label" - Toggle switch
- Dropdown "label" - Dropdown select
- List "Item1|Item2|Item3" - List (pipe-separated)
- NavMenu "Home|About|Contact" - Horizontal nav
- BottomNav "Tab1|Tab2|Tab3" - Bottom navigation
- AppBar "Title" - App header bar
- FAB "+" - Floating action button (circle)
- Icon "name" - Icon placeholder
- Avatar - User avatar circle
- Image - Image placeholder (X box)
- spacer - Flexible empty space
- divider - Horizontal line

MODIFIERS (after widget name):
- flex or flex=2 - Flexible sizing (fills space)
- width=100 - Fixed width in pixels
- height=50 - Fixed height in pixels
- padding=16 - Internal padding
- primary/secondary/danger/success/disabled - Button variants

WIREFRAME EXAMPLE (Login Screen):
wireframe mobile TD
screen "Login Screen"
    col padding=16
        spacer height=40
        Title "Welcome Back"
        spacer height=24
        Input "Email address"
        spacer height=12
        Input "Password"
        spacer height=24
        Button "Sign In" primary flex
        spacer height=16
        Text "Forgot password?"
        spacer

WIREFRAME EXAMPLE (Dashboard with multiple screens):
wireframe tablet LR
screen "Home"
    col
        AppBar "Dashboard"
        row flex padding=16
            Card flex
                col padding=12
                    Title "Stats"
                    Text "Active users: 1,234"
            Card flex
                col padding=12
                    Title "Revenue"
                    Text "$12,345"
        BottomNav "Home|Search|Profile"
screen "Detail"
    col
        AppBar "Item Detail"
        col flex padding=16
            Image height=200
            Title "Product Name"
            Text "Description goes here"
            spacer
            Button "Add to Cart" primary`,
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name for the diagram (without .mmd extension)',
              },
              content: {
                type: 'string',
                description: 'The Mermaid diagram syntax content',
              },
            },
            required: ['name', 'content'],
          },
        },
        {
          name: 'update_diagram',
          description: 'Update an existing diagram\'s Mermaid source code. Use get_diagram first to read current content if you need to make partial changes. The content replaces the entire diagram.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The diagram ID to update',
              },
              content: {
                type: 'string',
                description: 'The new Mermaid diagram content (replaces entire diagram)',
              },
            },
            required: ['id', 'content'],
          },
        },
        {
          name: 'validate_diagram',
          description: 'Check if Mermaid syntax is valid without saving. Use this before create_diagram or update_diagram to catch syntax errors early. Returns success or detailed error message.',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The Mermaid diagram syntax to validate',
              },
            },
            required: ['content'],
          },
        },
        {
          name: 'preview_diagram',
          description: 'Get the browser URL to view a rendered diagram. Share this URL to let others see the diagram. The preview updates in real-time when the diagram is modified.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The diagram ID to preview',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'list_documents',
          description: 'List all markdown documents. Returns document IDs, names, and metadata. Use this to see what documents exist before reading or updating them.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_document',
          description: 'Read a document\'s full content by ID. Use list_documents first to find available document IDs.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The document ID (without .md extension)',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'create_document',
          description: `Create a new markdown document. Returns the document ID and preview URL.

Documents support full GitHub-flavored markdown including:
- Headings (# ## ###)
- Lists (- or 1.)
- Code blocks (\`\`\`language)
- Tables
- Links and images
- Bold, italic, strikethrough

Use documents to write specifications, design docs, meeting notes, or any text content that should be viewable in the browser alongside diagrams.

Example document:
# Project Design

## Overview
This document describes the system architecture.

## Components
- **Frontend**: React application
- **Backend**: Node.js API
- **Database**: PostgreSQL

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /users | List users |
| POST | /users | Create user |`,
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name for the document (without .md extension)',
              },
              content: {
                type: 'string',
                description: 'The markdown content',
              },
            },
            required: ['name', 'content'],
          },
        },
        {
          name: 'update_document',
          description: 'Update an existing document\'s content. Use get_document first to read current content if you need to make partial changes.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The document ID to update',
              },
              content: {
                type: 'string',
                description: 'The new markdown content (replaces entire document)',
              },
            },
            required: ['id', 'content'],
          },
        },
        {
          name: 'preview_document',
          description: 'Get the browser URL to view a rendered document. Share this URL to let others see the document.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The document ID to preview',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'transpile_diagram',
          description: 'Get the transpiled Mermaid flowchart output for a SMACH state machine diagram. Use this to debug SMACH diagrams by seeing what Mermaid code is being generated.',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The SMACH diagram ID to transpile',
              },
            },
            required: ['id'],
          },
        },
      ],
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_diagrams': {
          const result = await listDiagrams();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'get_diagram': {
          if (!args || typeof args.id !== 'string') {
            throw new Error('Missing or invalid required argument: id');
          }
          const result = await getDiagram(args.id);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'create_diagram': {
          if (!args || typeof args.name !== 'string' || typeof args.content !== 'string') {
            throw new Error('Missing or invalid required arguments: name, content');
          }
          const result = await createDiagram(args.name, args.content);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'update_diagram': {
          if (!args || typeof args.id !== 'string' || typeof args.content !== 'string') {
            throw new Error('Missing or invalid required arguments: id, content');
          }
          const result = await updateDiagram(args.id, args.content);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'validate_diagram': {
          if (!args || typeof args.content !== 'string') {
            throw new Error('Missing or invalid required argument: content');
          }
          const result = await validateDiagram(args.content);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'preview_diagram': {
          if (!args || typeof args.id !== 'string') {
            throw new Error('Missing or invalid required argument: id');
          }
          const result = await previewDiagram(args.id);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'list_documents': {
          const result = await listDocuments();
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'get_document': {
          if (!args || typeof args.id !== 'string') {
            throw new Error('Missing or invalid required argument: id');
          }
          const result = await getDocument(args.id);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'create_document': {
          if (!args || typeof args.name !== 'string' || typeof args.content !== 'string') {
            throw new Error('Missing or invalid required arguments: name, content');
          }
          const result = await createDocument(args.name, args.content);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'update_document': {
          if (!args || typeof args.id !== 'string' || typeof args.content !== 'string') {
            throw new Error('Missing or invalid required arguments: id, content');
          }
          const result = await updateDocument(args.id, args.content);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'preview_document': {
          if (!args || typeof args.id !== 'string') {
            throw new Error('Missing or invalid required argument: id');
          }
          const result = await previewDocument(args.id);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        case 'transpile_diagram': {
          if (!args || typeof args.id !== 'string') {
            throw new Error('Missing or invalid required argument: id');
          }
          const result = await transpileDiagram(args.id);
          return {
            content: [
              {
                type: 'text',
                text: result,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // Start the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Mermaid Diagram Server running on stdio');
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
