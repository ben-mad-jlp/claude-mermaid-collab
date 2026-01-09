# Mermaid Collaboration Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real-time collaborative mermaid diagram editor with web UI and MCP integration for Claude Code.

**Architecture:** Two-server model - persistent web server (HTTP + WebSocket) shared by all users, and lightweight per-Claude MCP servers that wrap HTTP calls. Backend services manage diagrams as .mmd files with file watching for live updates.

**Tech Stack:** Bun runtime, TypeScript, Mermaid.js, Chokidar (file watching), MCP SDK, vanilla JavaScript frontend

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bun.lockb` (generated)
- Create: `diagrams/.gitkeep`

**Step 1: Initialize package.json**

Create `package.json`:

```json
{
  "name": "claude-mermaid-collab",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/server.ts",
    "mcp": "bun run src/mcp/server.ts"
  },
  "dependencies": {
    "mermaid": "^10.6.1",
    "@modelcontextprotocol/sdk": "^0.5.0",
    "chokidar": "^3.5.3"
  },
  "devDependencies": {
    "bun-types": "^1.0.0"
  }
}
```

**Step 2: Install dependencies**

Run: `bun install`
Expected: Dependencies installed, bun.lockb created

**Step 3: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create diagrams folder**

Run: `mkdir -p diagrams && touch diagrams/.gitkeep`
Expected: diagrams/ directory exists

**Step 5: Commit initial setup**

```bash
git add package.json tsconfig.json bun.lockb diagrams/.gitkeep
git commit -m "feat: initialize project with dependencies and config"
```

---

## Task 2: Configuration Module

**Files:**
- Create: `src/config.ts`

**Step 1: Write config module**

Create `src/config.ts`:

```typescript
export const config = {
  PORT: parseInt(process.env.PORT || '3737'),
  HOST: process.env.HOST || '0.0.0.0',
  DIAGRAMS_FOLDER: process.env.DIAGRAMS_FOLDER || './diagrams',
  MAX_FILE_SIZE: 1048576, // 1MB
  THUMBNAIL_CACHE_SIZE: 100,
  UNDO_HISTORY_SIZE: 50,
  WS_RECONNECT_MAX_DELAY: 30000,
} as const;
```

**Step 2: Verify config loads**

Run: `bun run -e "import { config } from './src/config.ts'; console.log(config)"`
Expected: Config object printed with default values

**Step 3: Commit config**

```bash
git add src/config.ts
git commit -m "feat: add configuration module"
```

---

## Task 3: DiagramManager Service

**Files:**
- Create: `src/services/diagram-manager.ts`
- Create: `src/types.ts`

**Step 1: Define types**

Create `src/types.ts`:

```typescript
export interface Diagram {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface DiagramMeta {
  name: string;
  path: string;
  lastModified: number;
}
```

**Step 2: Write DiagramManager skeleton**

Create `src/services/diagram-manager.ts`:

```typescript
import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Diagram, DiagramMeta } from '../types';
import { config } from '../config';

export class DiagramManager {
  private index: Map<string, DiagramMeta> = new Map();

  async initialize(): Promise<void> {
    // Scan diagrams folder and build index
    const files = await readdir(config.DIAGRAMS_FOLDER);

    for (const file of files) {
      if (!file.endsWith('.mmd')) continue;

      const id = basename(file, '.mmd');
      const path = join(config.DIAGRAMS_FOLDER, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: file,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDiagrams(): Promise<Diagram[]> {
    const diagrams: Diagram[] = [];

    for (const [id, meta] of this.index.entries()) {
      const content = await readFile(meta.path, 'utf-8');
      diagrams.push({
        id,
        name: meta.name,
        content,
        lastModified: meta.lastModified,
      });
    }

    return diagrams;
  }

  async getDiagram(id: string): Promise<Diagram | null> {
    const meta = this.index.get(id);
    if (!meta) return null;

    const content = await readFile(meta.path, 'utf-8');
    return {
      id,
      name: meta.name,
      content,
      lastModified: meta.lastModified,
    };
  }

  async saveDiagram(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Diagram ${id} not found`);

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Diagram too large');
    }

    await writeFile(meta.path, content, 'utf-8');
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;
  }

  async createDiagram(name: string, content: string): Promise<string> {
    // Sanitize filename
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${sanitized}.mmd`;
    const id = sanitized;
    const path = join(config.DIAGRAMS_FOLDER, filename);

    if (this.index.has(id)) {
      throw new Error(`Diagram ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Diagram too large');
    }

    await writeFile(path, content, 'utf-8');
    const stats = await stat(path);

    this.index.set(id, {
      name: filename,
      path,
      lastModified: stats.mtimeMs,
    });

    return id;
  }

  async deleteDiagram(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Diagram ${id} not found`);

    await unlink(meta.path);
    this.index.delete(id);
  }

  updateIndex(id: string, path: string): void {
    const filename = basename(path);
    stat(path).then(stats => {
      this.index.set(id, {
        name: filename,
        path,
        lastModified: stats.mtimeMs,
      });
    });
  }

  removeFromIndex(id: string): void {
    this.index.delete(id);
  }
}
```

**Step 3: Test manually**

Run:
```bash
echo "graph TD\n  A --> B" > diagrams/test.mmd
bun run -e "import { DiagramManager } from './src/services/diagram-manager.ts'; const dm = new DiagramManager(); await dm.initialize(); console.log(await dm.listDiagrams())"
```
Expected: Output shows test diagram

**Step 4: Commit DiagramManager**

```bash
git add src/types.ts src/services/diagram-manager.ts
git commit -m "feat: add DiagramManager service for CRUD operations"
```

---

## Task 4: Validator Service

**Files:**
- Create: `src/services/validator.ts`

**Step 1: Write Validator service**

Create `src/services/validator.ts`:

```typescript
export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
}

export class Validator {
  async validate(content: string): Promise<ValidationResult> {
    if (!content.trim()) {
      return { valid: false, error: 'Diagram cannot be empty' };
    }

    try {
      // Import mermaid dynamically
      const mermaid = await import('mermaid');

      // Try to parse the diagram
      await mermaid.default.parse(content);

      return { valid: true };
    } catch (error: any) {
      // Extract line number from error message if available
      const lineMatch = error.message?.match(/line (\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1]) : undefined;

      return {
        valid: false,
        error: error.message || 'Invalid mermaid syntax',
        line,
      };
    }
  }
}
```

**Step 2: Test validator**

Run:
```bash
bun run -e "import { Validator } from './src/services/validator.ts'; const v = new Validator(); console.log(await v.validate('graph TD\n  A --> B'))"
```
Expected: `{ valid: true }`

Run:
```bash
bun run -e "import { Validator } from './src/services/validator.ts'; const v = new Validator(); console.log(await v.validate('invalid syntax'))"
```
Expected: `{ valid: false, error: '...' }`

**Step 3: Commit validator**

```bash
git add src/services/validator.ts
git commit -m "feat: add Validator service for mermaid syntax checking"
```

---

## Task 5: Renderer Service

**Files:**
- Create: `src/services/renderer.ts`

**Step 1: Write Renderer service**

Create `src/services/renderer.ts`:

```typescript
import mermaid from 'mermaid';

export type Theme = 'default' | 'dark' | 'forest' | 'neutral';
export type Format = 'svg' | 'png';

export class Renderer {
  private thumbnailCache: Map<string, Buffer> = new Map();

  async renderSVG(content: string, theme: Theme = 'default'): Promise<string> {
    mermaid.initialize({
      theme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('diagram', content);
    return svg;
  }

  async generateThumbnail(id: string, content: string): Promise<Buffer> {
    // Check cache first
    const cached = this.thumbnailCache.get(id);
    if (cached) return cached;

    // Generate SVG
    const svg = await this.renderSVG(content, 'default');

    // For now, return SVG as buffer (PNG conversion would need puppeteer/sharp)
    // This is a simplified version - production would convert to PNG
    const buffer = Buffer.from(svg, 'utf-8');

    // Cache it (implement LRU if cache grows too large)
    if (this.thumbnailCache.size >= 100) {
      const firstKey = this.thumbnailCache.keys().next().value;
      this.thumbnailCache.delete(firstKey);
    }

    this.thumbnailCache.set(id, buffer);

    return buffer;
  }

  clearCache(): void {
    this.thumbnailCache.clear();
  }
}
```

**Step 2: Test renderer**

Run:
```bash
bun run -e "import { Renderer } from './src/services/renderer.ts'; const r = new Renderer(); const svg = await r.renderSVG('graph TD\n  A --> B'); console.log(svg.includes('<svg'))"
```
Expected: `true`

**Step 3: Commit renderer**

```bash
git add src/services/renderer.ts
git commit -m "feat: add Renderer service for SVG generation and thumbnails"
```

---

## Task 6: FileWatcher Service

**Files:**
- Create: `src/services/file-watcher.ts`

**Step 1: Write FileWatcher service**

Create `src/services/file-watcher.ts`:

```typescript
import chokidar from 'chokidar';
import { basename } from 'path';
import { config } from '../config';

export type FileChangeEvent = {
  type: 'created' | 'modified' | 'deleted';
  id: string;
  path: string;
};

export class FileWatcher {
  private watcher?: chokidar.FSWatcher;
  private listeners: Set<(event: FileChangeEvent) => void> = new Set();

  start(): void {
    this.watcher = chokidar.watch(`${config.DIAGRAMS_FOLDER}/*.mmd`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'created', id, path });
    });

    this.watcher.on('change', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'modified', id, path });
    });

    this.watcher.on('unlink', (path) => {
      const id = basename(path, '.mmd');
      this.emit({ type: 'deleted', id, path });
    });
  }

  stop(): void {
    this.watcher?.close();
  }

  onChange(listener: (event: FileChangeEvent) => void): void {
    this.listeners.add(listener);
  }

  private emit(event: FileChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
```

**Step 2: Test file watcher**

Run:
```bash
bun run -e "import { FileWatcher } from './src/services/file-watcher.ts'; const fw = new FileWatcher(); fw.onChange(e => console.log('Event:', e)); fw.start(); console.log('Watching...')"
```
Then in another terminal: `echo 'graph TD' > diagrams/watch-test.mmd`
Expected: Event logged in first terminal

**Step 3: Commit file watcher**

```bash
git add src/services/file-watcher.ts
git commit -m "feat: add FileWatcher service for monitoring diagram changes"
```

---

## Task 7: WebSocket Handler

**Files:**
- Create: `src/websocket/handler.ts`

**Step 1: Write WebSocket handler**

Create `src/websocket/handler.ts`:

```typescript
import type { ServerWebSocket } from 'bun';

export type WSMessage =
  | { type: 'connected'; diagramCount: number }
  | { type: 'diagram_updated'; id: string; content: string; lastModified: number }
  | { type: 'diagram_created'; id: string; name: string }
  | { type: 'diagram_deleted'; id: string }
  | { type: 'subscribe'; id: string }
  | { type: 'unsubscribe'; id: string };

export class WebSocketHandler {
  private connections: Set<ServerWebSocket<{ subscriptions: Set<string> }>> = new Set();

  handleConnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    ws.data.subscriptions = new Set();
    this.connections.add(ws);
  }

  handleDisconnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    this.connections.delete(ws);
  }

  handleMessage(ws: ServerWebSocket<{ subscriptions: Set<string> }>, message: string): void {
    try {
      const data = JSON.parse(message) as WSMessage;

      if (data.type === 'subscribe') {
        ws.data.subscriptions.add(data.id);
      } else if (data.type === 'unsubscribe') {
        ws.data.subscriptions.delete(data.id);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  broadcast(message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      ws.send(json);
    }
  }

  broadcastToDiagram(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        ws.send(json);
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
```

**Step 2: Commit WebSocket handler**

```bash
git add src/websocket/handler.ts
git commit -m "feat: add WebSocket handler for real-time updates"
```

---

## Task 8: HTTP Server with API Routes

**Files:**
- Create: `src/routes/api.ts`
- Create: `src/server.ts`

**Step 1: Write API routes**

Create `src/routes/api.ts`:

```typescript
import type { Server } from 'bun';
import { DiagramManager } from '../services/diagram-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';

export async function handleAPI(
  req: Request,
  diagramManager: DiagramManager,
  validator: Validator,
  renderer: Renderer,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // GET /api/diagrams
  if (path === '/api/diagrams' && req.method === 'GET') {
    const diagrams = await diagramManager.listDiagrams();
    return Response.json({ diagrams });
  }

  // GET /api/diagram/:id
  if (path.startsWith('/api/diagram/') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const diagram = await diagramManager.getDiagram(id);

    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    return Response.json(diagram);
  }

  // POST /api/diagram (create new)
  if (path === '/api/diagram' && req.method === 'POST') {
    const { name, content } = await req.json();

    if (!name || !content) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    // Validate first
    const validation = await validator.validate(content);
    if (!validation.valid) {
      return Response.json({
        success: false,
        error: validation.error,
        line: validation.line,
      }, { status: 400 });
    }

    try {
      const id = await diagramManager.createDiagram(name, content);
      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/diagram/:id (update)
  if (path.startsWith('/api/diagram/') && req.method === 'POST') {
    const id = path.split('/').pop()!;
    const { content } = await req.json();

    if (!content) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    // Validate first
    const validation = await validator.validate(content);
    if (!validation.valid) {
      return Response.json({
        success: false,
        error: validation.error,
        line: validation.line,
      }, { status: 400 });
    }

    try {
      await diagramManager.saveDiagram(id, content);
      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/diagram/:id
  if (path.startsWith('/api/diagram/') && req.method === 'DELETE') {
    const id = path.split('/').pop()!;

    try {
      await diagramManager.deleteDiagram(id);
      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // GET /api/render/:id
  if (path.startsWith('/api/render/') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const theme = (url.searchParams.get('theme') || 'default') as Theme;

    const diagram = await diagramManager.getDiagram(id);
    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    try {
      const svg = await renderer.renderSVG(diagram.content, theme);
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/thumbnail/:id
  if (path.startsWith('/api/thumbnail/') && req.method === 'GET') {
    const id = path.split('/').pop()!;

    const diagram = await diagramManager.getDiagram(id);
    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    try {
      const thumbnail = await renderer.generateThumbnail(id, diagram.content);
      return new Response(thumbnail, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/validate
  if (path === '/api/validate' && req.method === 'POST') {
    const { content } = await req.json();
    const result = await validator.validate(content);
    return Response.json(result);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
```

**Step 2: Write main server**

Create `src/server.ts`:

```typescript
import { mkdir } from 'fs/promises';
import { config } from './config';
import { DiagramManager } from './services/diagram-manager';
import { Validator } from './services/validator';
import { Renderer } from './services/renderer';
import { FileWatcher } from './services/file-watcher';
import { WebSocketHandler } from './websocket/handler';
import { handleAPI } from './routes/api';

// Initialize services
const diagramManager = new DiagramManager();
const validator = new Validator();
const renderer = new Renderer();
const fileWatcher = new FileWatcher();
const wsHandler = new WebSocketHandler();

// Ensure diagrams folder exists
await mkdir(config.DIAGRAMS_FOLDER, { recursive: true });

// Initialize diagram manager
await diagramManager.initialize();

// Set up file watcher
fileWatcher.onChange((event) => {
  if (event.type === 'created') {
    diagramManager.updateIndex(event.id, event.path);
    wsHandler.broadcast({
      type: 'diagram_created',
      id: event.id,
      name: event.id + '.mmd',
    });
  } else if (event.type === 'modified') {
    diagramManager.updateIndex(event.id, event.path);
    diagramManager.getDiagram(event.id).then((diagram) => {
      if (diagram) {
        wsHandler.broadcastToDiagram(event.id, {
          type: 'diagram_updated',
          id: event.id,
          content: diagram.content,
          lastModified: diagram.lastModified,
        });
      }
    });
  } else if (event.type === 'deleted') {
    diagramManager.removeFromIndex(event.id);
    wsHandler.broadcast({
      type: 'diagram_deleted',
      id: event.id,
    });
  }
});

fileWatcher.start();

// Create HTTP server
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: { subscriptions: new Set<string>() },
      });

      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(req, diagramManager, validator, renderer);
    }

    // Static files (will add in next task)
    if (url.pathname === '/') {
      return new Response('Dashboard coming soon', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    open(ws) {
      wsHandler.handleConnection(ws);
      ws.send(JSON.stringify({
        type: 'connected',
        diagramCount: wsHandler.getConnectionCount(),
      }));
    },

    message(ws, message) {
      wsHandler.handleMessage(ws, message.toString());
    },

    close(ws) {
      wsHandler.handleDisconnection(ws);
    },
  },
});

console.log(`🚀 Mermaid Collaboration Server running on http://${config.HOST}:${config.PORT}`);
console.log(`📁 Diagrams folder: ${config.DIAGRAMS_FOLDER}`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${config.PORT}/ws`);
```

**Step 3: Test server startup**

Run: `bun run src/server.ts`
Expected: Server starts, shows startup messages

**Step 4: Test API endpoint**

In another terminal:
```bash
curl http://localhost:3737/api/diagrams
```
Expected: `{"diagrams":[...]}`

**Step 5: Commit server**

```bash
git add src/routes/api.ts src/server.ts
git commit -m "feat: add HTTP server with REST API and WebSocket support"
```

---

## Task 9: Static File Serving

**Files:**
- Create: `public/index.html`
- Create: `public/diagram.html`
- Create: `public/css/styles.css`
- Create: `public/js/api-client.js`
- Modify: `src/server.ts`

**Step 1: Create API client**

Create `public/js/api-client.js`:

```javascript
class APIClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
    this.ws = null;
    this.wsListeners = new Set();
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connectionStatus = 'disconnected';
    this.statusListeners = new Set();
  }

  // HTTP API methods
  async getDiagrams() {
    const response = await fetch(`${this.baseURL}/api/diagrams`);
    return response.json();
  }

  async getDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`);
    return response.json();
  }

  async createDiagram(name, content) {
    const response = await fetch(`${this.baseURL}/api/diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    return response.json();
  }

  async updateDiagram(id, content) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  async deleteDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`, {
      method: 'DELETE',
    });
    return response.json();
  }

  async validateDiagram(content) {
    const response = await fetch(`${this.baseURL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  getThumbnailURL(id) {
    return `${this.baseURL}/api/thumbnail/${id}`;
  }

  getRenderURL(id, theme = 'default') {
    return `${this.baseURL}/api/render/${id}?theme=${theme}`;
  }

  // WebSocket methods
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsURL = `${protocol}//${window.location.host}/ws`;

    this.setStatus('connecting');
    this.ws = new WebSocket(wsURL);

    this.ws.onopen = () => {
      this.setStatus('connected');
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      for (const listener of this.wsListeners) {
        listener(message);
      }
    };

    this.ws.onclose = () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setStatus('disconnected');
    };
  }

  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendWebSocketMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(id) {
    this.sendWebSocketMessage({ type: 'subscribe', id });
  }

  unsubscribe(id) {
    this.sendWebSocketMessage({ type: 'unsubscribe', id });
  }

  onWebSocketMessage(listener) {
    this.wsListeners.add(listener);
  }

  offWebSocketMessage(listener) {
    this.wsListeners.delete(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
  }

  setStatus(status) {
    this.connectionStatus = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  scheduleReconnect() {
    setTimeout(() => {
      this.connectWebSocket();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  reconnect() {
    this.reconnectDelay = 1000;
    this.disconnectWebSocket();
    this.connectWebSocket();
  }
}

window.APIClient = APIClient;
```

**Step 2: Create global styles**

Create `public/css/styles.css`:

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}

.connection-status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.connection-status.connecting {
  background: #fff3e0;
  color: #f57c00;
}

.connection-status.disconnected {
  background: #ffebee;
  color: #c62828;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.search-box {
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  margin-bottom: 20px;
}

.search-box:focus {
  outline: none;
  border-color: #2196f3;
}
```

**Step 3: Create dashboard HTML**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mermaid Collaboration - Dashboard</title>
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    .diagram-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }

    .diagram-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .diagram-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }

    .diagram-thumbnail {
      width: 100%;
      height: 180px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .diagram-thumbnail img {
      max-width: 100%;
      max-height: 100%;
    }

    .diagram-info {
      padding: 16px;
    }

    .diagram-name {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .diagram-meta {
      font-size: 12px;
      color: #666;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Mermaid Diagrams</h1>
      <div class="connection-status disconnected" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </div>

    <input
      type="text"
      class="search-box"
      placeholder="Search diagrams..."
      id="search"
    >

    <div class="diagram-grid" id="grid"></div>
    <div class="empty-state" id="empty" style="display: none;">
      No diagrams found. Create one using the MCP tools!
    </div>
  </div>

  <script src="/js/api-client.js"></script>
  <script src="/js/dashboard.js"></script>
</body>
</html>
```

**Step 4: Create dashboard JavaScript**

Create `public/js/dashboard.js`:

```javascript
const api = new APIClient();
let diagrams = [];

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Load diagrams
async function loadDiagrams() {
  const response = await api.getDiagrams();
  diagrams = response.diagrams;
  renderGrid();
}

// Render grid
function renderGrid(filter = '') {
  const filtered = diagrams.filter(d =>
    d.name.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = filtered.map(diagram => `
    <div class="diagram-card" data-id="${diagram.id}">
      <div class="diagram-thumbnail">
        <img src="${api.getThumbnailURL(diagram.id)}" alt="${diagram.name}">
      </div>
      <div class="diagram-info">
        <div class="diagram-name">${diagram.name}</div>
        <div class="diagram-meta">
          Updated ${new Date(diagram.lastModified).toLocaleDateString()}
        </div>
      </div>
    </div>
  `).join('');

  // Add click handlers
  document.querySelectorAll('.diagram-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      window.location.href = `/diagram.html?id=${id}`;
    });
  });
}

// Search
search.addEventListener('input', (e) => {
  renderGrid(e.target.value);
});

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'diagram_created' || message.type === 'diagram_deleted') {
    loadDiagrams();
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Initialize
api.connectWebSocket();
loadDiagrams();
```

**Step 5: Update server to serve static files**

Modify `src/server.ts` - replace the static file handling section:

```typescript
    // Static files
    if (url.pathname === '/') {
      const file = Bun.file('public/index.html');
      return new Response(file);
    }

    if (url.pathname === '/diagram.html') {
      const file = Bun.file('public/diagram.html');
      return new Response(file);
    }

    if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
      const file = Bun.file(`public${url.pathname}`);
      const exists = await file.exists();

      if (!exists) {
        return new Response('Not found', { status: 404 });
      }

      const contentType = url.pathname.endsWith('.css')
        ? 'text/css'
        : url.pathname.endsWith('.js')
        ? 'application/javascript'
        : 'text/plain';

      return new Response(file, {
        headers: { 'Content-Type': contentType },
      });
    }
```

**Step 6: Test dashboard**

Run: `bun run src/server.ts`
Open browser: `http://localhost:3737`
Expected: Dashboard loads, shows connection status

**Step 7: Commit static files**

```bash
git add public/ src/server.ts
git commit -m "feat: add dashboard UI with diagram grid and WebSocket status"
```

---

## Task 10: Diagram Editor UI

**Files:**
- Create: `public/diagram.html`
- Create: `public/js/editor.js`

**Step 1: Create editor HTML**

Create `public/diagram.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagram Editor</title>
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    body {
      margin: 0;
      overflow: hidden;
    }

    .editor-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 20px;
      background: white;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
    }

    .diagram-title {
      font-size: 16px;
      font-weight: 600;
      flex: 1;
    }

    .toolbar-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button:hover {
      background: #f5f5f5;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .error-banner {
      padding: 12px 20px;
      background: #ffebee;
      color: #c62828;
      border-bottom: 1px solid #ef9a9a;
      display: none;
    }

    .error-banner.visible {
      display: block;
    }

    .split-pane {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .editor-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid #ddd;
    }

    .editor-textarea {
      flex: 1;
      padding: 16px;
      border: none;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      resize: none;
      outline: none;
    }

    .preview-pane {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      overflow: hidden;
      position: relative;
    }

    .preview-container {
      width: 100%;
      height: 100%;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.5.1/dist/panzoom.min.js"></script>
</head>
<body>
  <div class="editor-container">
    <div class="toolbar">
      <div class="diagram-title" id="title">Loading...</div>

      <div class="toolbar-group">
        <label>Theme:</label>
        <select id="theme">
          <option value="default">Default</option>
          <option value="dark">Dark</option>
          <option value="forest">Forest</option>
          <option value="neutral">Neutral</option>
        </select>
      </div>

      <div class="toolbar-group">
        <button id="undo" disabled>Undo</button>
        <button id="redo" disabled>Redo</button>
      </div>

      <div class="toolbar-group">
        <button id="export-svg">Export SVG</button>
        <button id="export-png">Export PNG</button>
        <button id="copy-code">Copy Code</button>
      </div>

      <div class="connection-status disconnected" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </div>

    <div class="error-banner" id="error"></div>

    <div class="split-pane">
      <div class="editor-pane">
        <textarea class="editor-textarea" id="editor" placeholder="Enter mermaid diagram code..."></textarea>
      </div>

      <div class="preview-pane">
        <div class="preview-container" id="preview"></div>
      </div>
    </div>
  </div>

  <script type="module" src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs"></script>
  <script src="/js/api-client.js"></script>
  <script src="/js/editor.js"></script>
</body>
</html>
```

**Step 2: Create editor JavaScript**

Create `public/js/editor.js`:

```javascript
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

const api = new APIClient();

// Get diagram ID from URL
const params = new URLSearchParams(window.location.search);
const diagramId = params.get('id');

if (!diagramId) {
  alert('No diagram ID specified');
  window.location.href = '/';
}

// DOM elements
const title = document.getElementById('title');
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const themeSelect = document.getElementById('theme');
const errorBanner = document.getElementById('error');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const exportSvgBtn = document.getElementById('export-svg');
const exportPngBtn = document.getElementById('export-png');
const copyCodeBtn = document.getElementById('copy-code');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// State
let currentContent = '';
let currentTheme = 'default';
let saveTimeout = null;
let undoStack = [];
let redoStack = [];
let panzoomInstance = null;

// Load diagram
async function loadDiagram() {
  const diagram = await api.getDiagram(diagramId);
  title.textContent = diagram.name;
  currentContent = diagram.content;
  editor.value = currentContent;
  undoStack = [currentContent];
  renderPreview();
}

// Render preview
async function renderPreview() {
  try {
    mermaid.initialize({
      theme: currentTheme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('preview-diagram', currentContent);
    preview.innerHTML = svg;

    // Initialize panzoom if not already
    if (!panzoomInstance) {
      const svgElement = preview.querySelector('svg');
      if (svgElement) {
        panzoomInstance = Panzoom(svgElement, {
          maxScale: 5,
          minScale: 0.1,
        });

        // Mouse wheel zoom
        preview.addEventListener('wheel', (e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          panzoomInstance.zoomWithWheel(e);
        });
      }
    }

    hideError();
  } catch (error) {
    showError(error.message);
  }
}

// Save diagram
async function saveDiagram() {
  const result = await api.updateDiagram(diagramId, currentContent);

  if (!result.success) {
    showError(`${result.error}${result.line ? ` (line ${result.line})` : ''}`);
  } else {
    hideError();
  }
}

// Auto-save with debounce
function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    await saveDiagram();
  }, 500);
}

// Error handling
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
}

// Undo/Redo
function pushUndo(content) {
  undoStack.push(content);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  if (undoStack.length <= 1) return;

  const current = undoStack.pop();
  redoStack.push(current);
  currentContent = undoStack[undoStack.length - 1];
  editor.value = currentContent;
  renderPreview();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;

  const content = redoStack.pop();
  undoStack.push(content);
  currentContent = content;
  editor.value = currentContent;
  renderPreview();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
}

// Export functions
async function exportSVG() {
  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${diagramId}.svg`;
  a.click();

  URL.revokeObjectURL(url);
}

async function exportPNG() {
  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diagramId}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

function copyCode() {
  navigator.clipboard.writeText(currentContent);
  const originalText = copyCodeBtn.textContent;
  copyCodeBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyCodeBtn.textContent = originalText;
  }, 2000);
}

// Event listeners
editor.addEventListener('input', (e) => {
  const newContent = e.target.value;
  if (newContent !== currentContent) {
    pushUndo(currentContent);
    currentContent = newContent;
    renderPreview();
    scheduleAutoSave();
  }
});

themeSelect.addEventListener('change', (e) => {
  currentTheme = e.target.value;
  renderPreview();
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
exportSvgBtn.addEventListener('click', exportSVG);
exportPngBtn.addEventListener('click', exportPNG);
copyCodeBtn.addEventListener('click', copyCode);

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'diagram_updated' && message.id === diagramId) {
    // External update - reload if content different
    if (message.content !== currentContent) {
      if (confirm('This diagram was updated externally. Reload?')) {
        currentContent = message.content;
        editor.value = currentContent;
        pushUndo(currentContent);
        renderPreview();
      }
    }
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Initialize
api.connectWebSocket();
api.subscribe(diagramId);
loadDiagram();
```

**Step 3: Test editor**

Create test diagram: `echo "graph TD\n  A --> B" > diagrams/test-editor.mmd`
Run server: `bun run src/server.ts`
Open: `http://localhost:3737/diagram.html?id=test-editor`
Expected: Editor loads with split view, can edit and see preview

**Step 4: Commit editor**

```bash
git add public/diagram.html public/js/editor.js
git commit -m "feat: add diagram editor with split-pane view and live preview"
```

---

## Task 11: MCP Server

**Files:**
- Create: `src/mcp/server.ts`

**Step 1: Write MCP server**

Create `src/mcp/server.ts`:

```typescript
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config';

const WEB_SERVER_URL = `http://localhost:${config.PORT}`;

// Check if web server is running
async function isWebServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${WEB_SERVER_URL}/api/diagrams`);
    return response.ok;
  } catch {
    return false;
  }
}

// Start web server if not running
async function ensureWebServerRunning(): Promise<void> {
  if (await isWebServerRunning()) {
    return;
  }

  console.error('Starting web server...');

  // Start web server as detached background process
  Bun.spawn(['bun', 'run', 'src/server.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });

  // Wait for server to start
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await isWebServerRunning()) {
      console.error('Web server started successfully');
      return;
    }
  }

  throw new Error('Failed to start web server');
}

// Create MCP server
const server = new Server(
  {
    name: 'mermaid-collab',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_diagrams',
        description: 'List all available mermaid diagrams',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_diagram',
        description: 'Get a specific diagram by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The diagram ID (filename without .mmd extension)',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'create_diagram',
        description: 'Create a new mermaid diagram',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The diagram name',
            },
            content: {
              type: 'string',
              description: 'The mermaid diagram code',
            },
          },
          required: ['name', 'content'],
        },
      },
      {
        name: 'update_diagram',
        description: 'Update an existing diagram',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The diagram ID',
            },
            content: {
              type: 'string',
              description: 'The new mermaid diagram code',
            },
          },
          required: ['id', 'content'],
        },
      },
      {
        name: 'validate_diagram',
        description: 'Validate mermaid diagram syntax without saving',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The mermaid diagram code to validate',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'preview_diagram',
        description: 'Get the browser URL for previewing a diagram',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The diagram ID',
            },
          },
          required: ['id'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Ensure web server is running
  await ensureWebServerRunning();

  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_diagrams': {
        const response = await fetch(`${WEB_SERVER_URL}/api/diagrams`);
        const data = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data.diagrams, null, 2),
            },
          ],
        };
      }

      case 'get_diagram': {
        const { id } = args as { id: string };
        const response = await fetch(`${WEB_SERVER_URL}/api/diagram/${id}`);
        const data = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'create_diagram': {
        const { name, content } = args as { name: string; content: string };
        const response = await fetch(`${WEB_SERVER_URL}/api/diagram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content }),
        });
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to create diagram');
        }

        const url = `http://${config.HOST}:${config.PORT}/diagram.html?id=${data.id}`;
        return {
          content: [
            {
              type: 'text',
              text: `Diagram created successfully!\n\nID: ${data.id}\nURL: ${url}`,
            },
          ],
        };
      }

      case 'update_diagram': {
        const { id, content } = args as { id: string; content: string };
        const response = await fetch(`${WEB_SERVER_URL}/api/diagram/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to update diagram');
        }

        return {
          content: [
            {
              type: 'text',
              text: 'Diagram updated successfully!',
            },
          ],
        };
      }

      case 'validate_diagram': {
        const { content } = args as { content: string };
        const response = await fetch(`${WEB_SERVER_URL}/api/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await response.json();

        if (data.valid) {
          return {
            content: [
              {
                type: 'text',
                text: 'Diagram syntax is valid!',
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Validation failed: ${data.error}${data.line ? ` (line ${data.line})` : ''}`,
              },
            ],
          };
        }
      }

      case 'preview_diagram': {
        const { id } = args as { id: string };
        const url = `http://${config.HOST}:${config.PORT}/diagram.html?id=${id}`;
        return {
          content: [
            {
              type: 'text',
              text: `Open this URL in your browser to view the diagram:\n\n${url}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mermaid Collaboration MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Step 2: Make MCP server executable**

Run: `chmod +x src/mcp/server.ts`

**Step 3: Test MCP server manually**

Test that it can start and respond (will test full integration separately):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | bun run src/mcp/server.ts
```
Expected: JSON response with tool list

**Step 4: Commit MCP server**

```bash
git add src/mcp/server.ts package.json
git commit -m "feat: add MCP server with diagram management tools"
```

---

## Task 12: Documentation and README

**Files:**
- Create: `README.md`
- Create: `docs/MCP_SETUP.md`

**Step 1: Create README**

Create `README.md`:

```markdown
# Mermaid Collaboration Server

Real-time collaborative mermaid diagram editor with web UI and Claude Code MCP integration.

## Features

- 🎨 Web-based diagram editor with live preview
- 🔄 Real-time updates via WebSocket
- 🤖 Claude Code integration via MCP
- 📁 File-based storage (.mmd files)
- 🎭 Multiple themes (default, dark, forest, neutral)
- 📤 Export to SVG/PNG
- ↩️ Undo/redo support
- 🔍 Pan and zoom preview

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed

### Installation

```bash
# Install dependencies
bun install

# Start the web server
bun run dev
```

The server will start on `http://0.0.0.0:3737`

Access from any device on your LAN: `http://<server-ip>:3737`

### Creating Diagrams

Create `.mmd` files in the `diagrams/` folder:

```bash
echo "graph TD\n  A[Start] --> B[End]" > diagrams/example.mmd
```

Or use Claude Code via MCP (see [MCP Setup](docs/MCP_SETUP.md))

## Usage

### Web Interface

1. **Dashboard** (`/`): View all diagrams, search, click to edit
2. **Editor** (`/diagram.html?id=<name>`): Edit with live preview

### MCP Tools (Claude Code)

See [MCP_SETUP.md](docs/MCP_SETUP.md) for configuration.

Available tools:
- `list_diagrams()` - List all diagrams
- `get_diagram(id)` - Get diagram content
- `create_diagram(name, content)` - Create new diagram
- `update_diagram(id, content)` - Update existing diagram
- `validate_diagram(content)` - Validate syntax
- `preview_diagram(id)` - Get browser URL

## Configuration

Set via environment variables:

- `PORT` - Server port (default: 3737)
- `HOST` - Bind address (default: 0.0.0.0)
- `DIAGRAMS_FOLDER` - Diagram storage path (default: ./diagrams)

## Architecture

- **Web Server**: Bun HTTP server with WebSocket support
- **MCP Server**: Lightweight stdio wrapper around HTTP API
- **Storage**: Plain .mmd files on disk
- **Frontend**: Vanilla JavaScript with Mermaid.js

See [Design Document](docs/plans/2026-01-09-mermaid-collab-server-design.md) for details.

## Development

```bash
# Start web server (watches for file changes)
bun run dev

# Start MCP server (for Claude Code)
bun run mcp
```

## License

MIT
```

**Step 2: Create MCP setup guide**

Create `docs/MCP_SETUP.md`:

```markdown
# MCP Setup for Claude Code

Configure Claude Code to use the Mermaid Collaboration MCP server.

## Configuration

Add to your Claude Code MCP settings (typically `~/.config/claude/mcp.json` or project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "mermaid-collab": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"],
      "cwd": "/absolute/path/to/claude-mermaid-collab"
    }
  }
}
```

Replace `/absolute/path/to/claude-mermaid-collab` with the actual path to this project.

## Usage

Once configured, Claude Code can use these tools:

### list_diagrams()

Lists all available diagrams.

**Example:**
```
User: "Show me all diagrams"
Claude: *uses list_diagrams()*
```

### get_diagram(id)

Retrieves a specific diagram's content.

**Example:**
```
User: "Show me the architecture diagram"
Claude: *uses get_diagram(id="architecture")*
```

### create_diagram(name, content)

Creates a new diagram.

**Example:**
```
User: "Create a diagram showing the authentication flow"
Claude: *uses create_diagram(name="auth-flow", content="sequenceDiagram...")*
```

### update_diagram(id, content)

Updates an existing diagram.

**Example:**
```
User: "Update the auth-flow diagram to include OAuth"
Claude: *uses update_diagram(id="auth-flow", content="...")*
```

### validate_diagram(content)

Validates mermaid syntax without saving.

**Example:**
```
Claude: *validates before creating/updating*
```

### preview_diagram(id)

Gets the browser URL for viewing a diagram.

**Example:**
```
User: "Open the auth-flow diagram"
Claude: *uses preview_diagram(id="auth-flow")*
        "Open this URL: http://0.0.0.0:3737/diagram.html?id=auth-flow"
```

## Auto-Start Behavior

The MCP server automatically:
1. Checks if the web server is running
2. Starts it if not running
3. Keeps it running for all Claude instances to share

Multiple Claude Code sessions can share the same web server instance.

## Troubleshooting

**MCP server not connecting:**
- Check that Bun is installed: `bun --version`
- Verify the path in MCP config is correct
- Check Claude Code MCP logs

**Web server won't start:**
- Ensure port 3737 is available
- Check file permissions on `diagrams/` folder
- Run manually: `bun run src/server.ts`

**Diagrams not appearing:**
- Ensure `.mmd` files exist in `diagrams/` folder
- Check file permissions
- Refresh the dashboard
```

**Step 3: Commit documentation**

```bash
git add README.md docs/MCP_SETUP.md
git commit -m "docs: add README and MCP setup guide"
```

---

## Task 13: Final Integration Testing

**Files:**
- Create: `diagrams/test-integration.mmd`

**Step 1: Create test diagram**

```bash
cat > diagrams/test-integration.mmd << 'EOF'
graph TD
    A[Claude Code] -->|MCP| B[MCP Server]
    B -->|HTTP| C[Web Server]
    C -->|WebSocket| D[Browser]
    D -->|Edit| C
    C -->|Save| E[.mmd Files]
    E -->|Watch| C
EOF
```

**Step 2: Test complete flow**

1. Start web server: `bun run src/server.ts`
2. Open browser: `http://localhost:3737`
3. Verify dashboard shows test-integration diagram
4. Click to open editor
5. Edit diagram and verify auto-save
6. Open second browser tab, verify live updates
7. Edit .mmd file externally, verify WebSocket update

Expected: All features work end-to-end

**Step 3: Test MCP integration**

Configure MCP in Claude Code settings, then test:
- `list_diagrams()` returns diagrams
- `create_diagram()` creates and validates
- `update_diagram()` updates with validation
- Web server auto-starts if not running

**Step 4: Commit test diagram**

```bash
git add diagrams/test-integration.mmd
git commit -m "test: add integration test diagram"
```

---

## Completion

All tasks complete! The mermaid collaboration server is ready with:

✅ Web server with REST API and WebSocket
✅ Backend services (DiagramManager, Validator, Renderer, FileWatcher)
✅ Dashboard UI with real-time updates
✅ Editor UI with live preview, undo/redo, export
✅ MCP server with Claude Code integration
✅ Documentation and setup guides

**Next steps:**
- Test with multiple users on LAN
- Add more mermaid themes if needed
- Consider adding PNG export with better quality (puppeteer/sharp)
- Deploy to production server if desired
