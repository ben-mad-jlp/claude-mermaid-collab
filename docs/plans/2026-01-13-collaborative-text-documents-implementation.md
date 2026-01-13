# Collaborative Text Documents Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add markdown document collaboration to the Mermaid server with inline comments, section approval, and real-time sync.

**Architecture:** Extends existing server with parallel document storage (`documents/` folder), mirroring the diagram patterns. Documents are plain `.md` files with HTML comment markers for status and comments. Split-pane editor with synchronized scrolling.

**Tech Stack:** Bun, TypeScript, marked (markdown renderer), existing WebSocket infrastructure.

---

## Task 1: Add Document Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Add Document and DocumentMeta interfaces**

Add to `src/types.ts`:

```typescript
export interface Document {
  id: string;
  name: string;
  content: string;
  lastModified: number;
}

export interface DocumentMeta {
  name: string;
  path: string;
  lastModified: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Document types"
```

---

## Task 2: Add Documents Folder Config

**Files:**
- Modify: `src/config.ts`

**Step 1: Add DOCUMENTS_FOLDER to config**

Add to the config object in `src/config.ts`:

```typescript
DOCUMENTS_FOLDER: process.env.DOCUMENTS_FOLDER || './documents',
```

**Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat: add DOCUMENTS_FOLDER config"
```

---

## Task 3: Create DocumentManager Service

**Files:**
- Create: `src/services/document-manager.ts`

**Step 1: Create the DocumentManager class**

Create `src/services/document-manager.ts`:

```typescript
import { readdir, readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Document, DocumentMeta } from '../types';
import { config } from '../config';

export class DocumentManager {
  private index: Map<string, DocumentMeta> = new Map();

  async initialize(): Promise<void> {
    const files = await readdir(config.DOCUMENTS_FOLDER);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const id = basename(file, '.md');
      const path = join(config.DOCUMENTS_FOLDER, file);
      const stats = await stat(path);

      this.index.set(id, {
        name: file,
        path,
        lastModified: stats.mtimeMs,
      });
    }
  }

  async listDocuments(): Promise<Document[]> {
    const documents: Document[] = [];

    for (const [id, meta] of this.index.entries()) {
      const content = await readFile(meta.path, 'utf-8');
      documents.push({
        id,
        name: meta.name,
        content,
        lastModified: meta.lastModified,
      });
    }

    return documents;
  }

  async getDocument(id: string): Promise<Document | null> {
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

  async saveDocument(id: string, content: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Document ${id} not found`);

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Document too large');
    }

    await writeFile(meta.path, content, 'utf-8');
    const stats = await stat(meta.path);
    meta.lastModified = stats.mtimeMs;
  }

  async createDocument(name: string, content: string): Promise<string> {
    const sanitized = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filename = `${sanitized}.md`;
    const id = sanitized;
    const path = join(config.DOCUMENTS_FOLDER, filename);

    if (this.index.has(id)) {
      throw new Error(`Document ${id} already exists`);
    }

    if (content.length > config.MAX_FILE_SIZE) {
      throw new Error('Document too large');
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

  async deleteDocument(id: string): Promise<void> {
    const meta = this.index.get(id);
    if (!meta) throw new Error(`Document ${id} not found`);

    await unlink(meta.path);
    this.index.delete(id);
  }

  async getCleanContent(id: string): Promise<string | null> {
    const doc = await this.getDocument(id);
    if (!doc) return null;

    // Strip all comment markers
    return doc.content
      .replace(/<!--\s*status:\s*(approved|rejected)\s*-->\n?/g, '')
      .replace(/<!--\s*comment:\s*[^>]*-->\n?/g, '')
      .replace(/<!--\s*comment-start:\s*[^>]*-->/g, '')
      .replace(/<!--\s*comment-end\s*-->/g, '');
  }

  updateIndex(id: string, path: string): void {
    const filename = basename(path);
    stat(path).then(stats => {
      this.index.set(id, {
        name: filename,
        path,
        lastModified: stats.mtimeMs,
      });
    }).catch(error => {
      console.error(`Failed to update index for ${id}:`, error);
    });
  }

  removeFromIndex(id: string): void {
    this.index.delete(id);
  }
}
```

**Step 2: Commit**

```bash
git add src/services/document-manager.ts
git commit -m "feat: add DocumentManager service"
```

---

## Task 4: Update WebSocket Handler for Documents

**Files:**
- Modify: `src/websocket/handler.ts`

**Step 1: Add document message types**

Update the `WSMessage` type in `src/websocket/handler.ts`:

```typescript
export type WSMessage =
  | { type: 'connected'; diagramCount: number }
  | { type: 'diagram_updated'; id: string; content: string; lastModified: number }
  | { type: 'diagram_created'; id: string; name: string }
  | { type: 'diagram_deleted'; id: string }
  | { type: 'document_updated'; id: string; content: string; lastModified: number }
  | { type: 'document_created'; id: string; name: string }
  | { type: 'document_deleted'; id: string }
  | { type: 'subscribe'; id: string }
  | { type: 'unsubscribe'; id: string };
```

**Step 2: Add broadcastToDocument method**

Add this method to the `WebSocketHandler` class (identical pattern to `broadcastToDiagram`):

```typescript
broadcastToDocument(id: string, message: WSMessage): void {
  const json = JSON.stringify(message);
  for (const ws of this.connections) {
    if (ws.data.subscriptions.has(id)) {
      ws.send(json);
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/websocket/handler.ts
git commit -m "feat: add document WebSocket events"
```

---

## Task 5: Update File Watcher for Documents

**Files:**
- Modify: `src/services/file-watcher.ts`

**Step 1: Update FileChangeEvent type**

Update the type to include resource type:

```typescript
export type FileChangeEvent = {
  type: 'created' | 'modified' | 'deleted';
  resourceType: 'diagram' | 'document';
  id: string;
  path: string;
};
```

**Step 2: Update start() to watch both folders**

Replace the `start()` method:

```typescript
start(): void {
  // Watch diagrams
  const diagramWatcher = chokidar.watch(`${config.DIAGRAMS_FOLDER}/*.mmd`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  diagramWatcher.on('add', (path) => {
    const id = basename(path, '.mmd');
    this.emit({ type: 'created', resourceType: 'diagram', id, path });
  });

  diagramWatcher.on('change', (path) => {
    const id = basename(path, '.mmd');
    this.emit({ type: 'modified', resourceType: 'diagram', id, path });
  });

  diagramWatcher.on('unlink', (path) => {
    const id = basename(path, '.mmd');
    this.emit({ type: 'deleted', resourceType: 'diagram', id, path });
  });

  // Watch documents
  const documentWatcher = chokidar.watch(`${config.DOCUMENTS_FOLDER}/*.md`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  documentWatcher.on('add', (path) => {
    const id = basename(path, '.md');
    this.emit({ type: 'created', resourceType: 'document', id, path });
  });

  documentWatcher.on('change', (path) => {
    const id = basename(path, '.md');
    this.emit({ type: 'modified', resourceType: 'document', id, path });
  });

  documentWatcher.on('unlink', (path) => {
    const id = basename(path, '.md');
    this.emit({ type: 'deleted', resourceType: 'document', id, path });
  });

  this.watcher = diagramWatcher;
  this.documentWatcher = documentWatcher;
}
```

**Step 3: Add documentWatcher property and update stop()**

Add property and update stop:

```typescript
private watcher?: chokidar.FSWatcher;
private documentWatcher?: chokidar.FSWatcher;

stop(): void {
  this.watcher?.close();
  this.documentWatcher?.close();
}
```

**Step 4: Commit**

```bash
git add src/services/file-watcher.ts
git commit -m "feat: watch documents folder"
```

---

## Task 6: Add Document API Routes

**Files:**
- Modify: `src/routes/api.ts`

**Step 1: Update imports and function signature**

Update the imports and add DocumentManager parameter:

```typescript
import type { Server } from 'bun';
import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';

export async function handleAPI(
  req: Request,
  diagramManager: DiagramManager,
  documentManager: DocumentManager,
  validator: Validator,
  renderer: Renderer,
  wsHandler: WebSocketHandler,
): Promise<Response> {
```

**Step 2: Add document routes before the final 404**

Add these routes before `return Response.json({ error: 'Not found' }, { status: 404 });`:

```typescript
  // GET /api/documents
  if (path === '/api/documents' && req.method === 'GET') {
    const documents = await documentManager.listDocuments();
    return Response.json({ documents });
  }

  // GET /api/document/:id
  if (path.startsWith('/api/document/') && !path.includes('/clean') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const document = await documentManager.getDocument(id);

    if (!document) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json(document);
  }

  // GET /api/document/:id/clean
  if (path.match(/^\/api\/document\/[^/]+\/clean$/) && req.method === 'GET') {
    const id = path.split('/')[3];
    const content = await documentManager.getCleanContent(id);

    if (content === null) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json({ content });
  }

  // POST /api/document (create new)
  if (path === '/api/document' && req.method === 'POST') {
    const { name, content } = await req.json();

    if (!name || content === undefined) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    try {
      const id = await documentManager.createDocument(name, content);

      wsHandler.broadcast({
        type: 'document_created',
        id,
        name: name + '.md',
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/document/:id (update)
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'POST') {
    const id = path.split('/').pop()!;
    const { content } = await req.json();

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      await documentManager.saveDocument(id, content);

      const document = await documentManager.getDocument(id);
      if (document) {
        wsHandler.broadcastToDocument(id, {
          type: 'document_updated',
          id,
          content: document.content,
          lastModified: document.lastModified,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/document/:id
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'DELETE') {
    const id = path.split('/').pop()!;

    try {
      await documentManager.deleteDocument(id);

      wsHandler.broadcast({
        type: 'document_deleted',
        id,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }
```

**Step 3: Commit**

```bash
git add src/routes/api.ts
git commit -m "feat: add document API routes"
```

---

## Task 7: Update Server to Initialize Documents

**Files:**
- Modify: `src/server.ts`

**Step 1: Import DocumentManager**

Add import:

```typescript
import { DocumentManager } from './services/document-manager';
```

**Step 2: Initialize DocumentManager**

Add after `const diagramManager = new DiagramManager();`:

```typescript
const documentManager = new DocumentManager();
```

**Step 3: Create documents folder**

Add after the diagrams folder creation:

```typescript
await mkdir(config.DOCUMENTS_FOLDER, { recursive: true });
```

**Step 4: Initialize document manager**

Add after `await diagramManager.initialize();`:

```typescript
await documentManager.initialize();
```

**Step 5: Update file watcher handler**

Update the `fileWatcher.onChange` callback to handle both resource types:

```typescript
fileWatcher.onChange((event) => {
  if (event.resourceType === 'diagram') {
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
  } else if (event.resourceType === 'document') {
    if (event.type === 'created') {
      documentManager.updateIndex(event.id, event.path);
      wsHandler.broadcast({
        type: 'document_created',
        id: event.id,
        name: event.id + '.md',
      });
    } else if (event.type === 'modified') {
      documentManager.updateIndex(event.id, event.path);
      documentManager.getDocument(event.id).then((document) => {
        if (document) {
          wsHandler.broadcastToDocument(event.id, {
            type: 'document_updated',
            id: event.id,
            content: document.content,
            lastModified: document.lastModified,
          });
        }
      });
    } else if (event.type === 'deleted') {
      documentManager.removeFromIndex(event.id);
      wsHandler.broadcast({
        type: 'document_deleted',
        id: event.id,
      });
    }
  }
});
```

**Step 6: Update handleAPI call**

Update the API handler call to pass documentManager:

```typescript
return handleAPI(req, diagramManager, documentManager, validator, renderer, wsHandler);
```

**Step 7: Add document.html route**

Add after the `diagram.html` route:

```typescript
if (url.pathname === '/document.html') {
  const file = Bun.file('public/document.html');
  return new Response(file);
}
```

**Step 8: Update startup logs**

Add after the existing logs:

```typescript
console.log(`📄 Documents folder: ${config.DOCUMENTS_FOLDER}`);
```

**Step 9: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire up document support in server"
```

---

## Task 8: Install marked Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install marked**

```bash
cd /home/qbintelligence/code/claude-mermaid-collab && bun add marked
```

**Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "feat: add marked for markdown rendering"
```

---

## Task 9: Update API Client for Documents

**Files:**
- Modify: `public/js/api-client.js`

**Step 1: Add document HTTP methods**

Add these methods to the APIClient class after the diagram methods:

```javascript
// Document API methods
async getDocuments() {
  const response = await fetch(`${this.baseURL}/api/documents`);
  return response.json();
}

async getDocument(id) {
  const response = await fetch(`${this.baseURL}/api/document/${id}`);
  return response.json();
}

async createDocument(name, content) {
  const response = await fetch(`${this.baseURL}/api/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  return response.json();
}

async updateDocument(id, content) {
  const response = await fetch(`${this.baseURL}/api/document/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return response.json();
}

async deleteDocument(id) {
  const response = await fetch(`${this.baseURL}/api/document/${id}`, {
    method: 'DELETE',
  });
  return response.json();
}

async getCleanDocument(id) {
  const response = await fetch(`${this.baseURL}/api/document/${id}/clean`);
  return response.json();
}
```

**Step 2: Commit**

```bash
git add public/js/api-client.js
git commit -m "feat: add document methods to API client"
```

---

## Task 10: Create Document Editor HTML

**Files:**
- Create: `public/document.html`

**Step 1: Create the document editor page**

Create `public/document.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Editor</title>
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

    .document-title {
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

    button.approve {
      border-color: #4caf50;
      color: #4caf50;
    }

    button.approve:hover {
      background: #e8f5e9;
    }

    button.reject {
      border-color: #f44336;
      color: #f44336;
    }

    button.reject:hover {
      background: #ffebee;
    }

    select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .split-pane {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .editor-pane {
      flex: 0 0 50%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .resizer {
      width: 8px;
      background: #ddd;
      cursor: col-resize;
      flex-shrink: 0;
    }

    .resizer:hover {
      background: #aaa;
    }

    .editor-textarea {
      flex: 1;
      padding: 16px;
      border: none;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      resize: none;
      outline: none;
      line-height: 1.6;
    }

    .preview-pane {
      flex: 1;
      overflow-y: auto;
      background: #fafafa;
      padding: 20px;
    }

    .preview-content {
      max-width: 800px;
      margin: 0 auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
    }

    /* Markdown preview styles */
    .preview-content h1, .preview-content h2, .preview-content h3 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    .preview-content p {
      margin: 1em 0;
    }

    .preview-content code {
      background: #e8e8e8;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }

    .preview-content pre {
      background: #2d2d2d;
      color: #f8f8f2;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
    }

    .preview-content pre code {
      background: none;
      padding: 0;
    }

    /* Section status styles */
    .section-approved {
      border-left: 4px solid #4caf50;
      padding-left: 16px;
      background: #f1f8e9;
      margin: 8px 0;
    }

    .section-rejected {
      border-left: 4px solid #f44336;
      padding-left: 16px;
      background: #ffebee;
      margin: 8px 0;
    }

    /* Comment styles */
    .comment-block {
      background: #fff3e0;
      border-left: 4px solid #ff9800;
      padding: 8px 16px;
      margin: 8px 0;
      font-style: italic;
    }

    .comment-inline {
      background: #fff9c4;
      border-bottom: 2px solid #ffc107;
      cursor: help;
    }

    .comment-tooltip {
      position: absolute;
      background: #333;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 13px;
      max-width: 300px;
      z-index: 1000;
      display: none;
    }
  </style>
</head>
<body>
  <div class="editor-container">
    <div class="toolbar">
      <button id="back-button" title="Back to Dashboard">←</button>
      <div class="document-title" id="title">Loading...</div>

      <div class="toolbar-group">
        <button id="add-comment" title="Add Comment">💬 Comment</button>
        <button id="approve-section" class="approve" title="Approve Section">✓ Approve</button>
        <button id="reject-section" class="reject" title="Reject Section">✗ Reject</button>
      </div>

      <div class="toolbar-group">
        <select id="export-select">
          <option value="">Export...</option>
          <option value="clean">Export Clean</option>
          <option value="raw">Export Raw</option>
        </select>
      </div>

      <div class="connection-status disconnected" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </div>

    <div class="split-pane">
      <div class="editor-pane">
        <textarea class="editor-textarea" id="editor" placeholder="Enter markdown..."></textarea>
      </div>

      <div class="resizer" id="resizer"></div>

      <div class="preview-pane" id="preview-pane">
        <div class="preview-content" id="preview"></div>
      </div>
    </div>
  </div>

  <div class="comment-tooltip" id="tooltip"></div>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script type="module" src="/js/api-client.js"></script>
  <script type="module" src="/js/document-editor.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add public/document.html
git commit -m "feat: add document editor HTML"
```

---

## Task 11: Create Document Editor JavaScript

**Files:**
- Create: `public/js/document-editor.js`

**Step 1: Create the document editor script**

Create `public/js/document-editor.js`:

```javascript
import APIClient from './api-client.js';

const api = new APIClient();

// DOM elements
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewPane = document.getElementById('preview-pane');
const title = document.getElementById('title');
const backButton = document.getElementById('back-button');
const addCommentBtn = document.getElementById('add-comment');
const approveSectionBtn = document.getElementById('approve-section');
const rejectSectionBtn = document.getElementById('reject-section');
const exportSelect = document.getElementById('export-select');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const resizer = document.getElementById('resizer');
const tooltip = document.getElementById('tooltip');

// State
let documentId = null;
let saveTimeout = null;
let isUpdatingFromServer = false;
let isSyncing = false;

// Get document ID from URL
const params = new URLSearchParams(window.location.search);
documentId = params.get('id');

if (!documentId) {
  window.location.href = '/';
}

// Load document
async function loadDocument() {
  const doc = await api.getDocument(documentId);
  if (doc.error) {
    alert('Document not found');
    window.location.href = '/';
    return;
  }

  title.textContent = doc.name;
  document.title = `${doc.name} - Document Editor`;
  editor.value = doc.content;
  renderPreview();
}

// Render markdown preview with custom processing
function renderPreview() {
  let content = editor.value;

  // Process status markers - wrap sections
  content = processStatusMarkers(content);

  // Process comment markers
  content = processCommentMarkers(content);

  // Render markdown
  preview.innerHTML = marked.parse(content);

  // Add tooltip handlers for inline comments
  setupTooltips();
}

// Process <!-- status: approved/rejected --> markers
function processStatusMarkers(content) {
  const lines = content.split('\n');
  const result = [];
  let currentStatus = null;
  let sectionContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for heading
    if (line.match(/^#{1,6}\s/)) {
      // Close previous section if open
      if (currentStatus && sectionContent.length > 0) {
        result.push(`<div class="section-${currentStatus}">`);
        result.push(...sectionContent);
        result.push('</div>');
        sectionContent = [];
      }
      currentStatus = null;
      result.push(line);
      continue;
    }

    // Check for status marker
    const statusMatch = line.match(/<!--\s*status:\s*(approved|rejected)\s*-->/);
    if (statusMatch) {
      currentStatus = statusMatch[1];
      continue; // Don't include the marker in output
    }

    // Add line to current section or result
    if (currentStatus) {
      sectionContent.push(line);
    } else {
      result.push(line);
    }
  }

  // Close final section if open
  if (currentStatus && sectionContent.length > 0) {
    result.push(`<div class="section-${currentStatus}">`);
    result.push(...sectionContent);
    result.push('</div>');
  }

  return result.join('\n');
}

// Process comment markers
function processCommentMarkers(content) {
  // Standalone comments: <!-- comment: text -->
  content = content.replace(
    /<!--\s*comment:\s*([^>]+)-->/g,
    '<div class="comment-block">$1</div>'
  );

  // Inline comments: <!-- comment-start: text -->...<!-- comment-end -->
  content = content.replace(
    /<!--\s*comment-start:\s*([^>]+)-->([\s\S]*?)<!--\s*comment-end\s*-->/g,
    '<span class="comment-inline" data-comment="$1">$2</span>'
  );

  return content;
}

// Setup tooltip handlers for inline comments
function setupTooltips() {
  const inlineComments = preview.querySelectorAll('.comment-inline');

  inlineComments.forEach(el => {
    el.addEventListener('mouseenter', (e) => {
      const comment = el.dataset.comment;
      tooltip.textContent = comment;
      tooltip.style.display = 'block';

      const rect = el.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.top = (rect.bottom + 8) + 'px';
    });

    el.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

// Save document with debounce
function scheduleeSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (isUpdatingFromServer) return;

    await api.updateDocument(documentId, editor.value);
  }, 500);
}

// Find the nearest heading before cursor position
function findNearestHeading(text, cursorPos) {
  const beforeCursor = text.substring(0, cursorPos);
  const lines = beforeCursor.split('\n');

  // Find last heading line
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^#{1,6}\s/)) {
      // Calculate position after this heading line
      let pos = 0;
      for (let j = 0; j <= i; j++) {
        pos += lines[j].length + 1; // +1 for newline
      }
      return pos;
    }
  }

  return 0; // No heading found, return start
}

// Insert text at position
function insertAtPosition(pos, text) {
  const before = editor.value.substring(0, pos);
  const after = editor.value.substring(pos);
  editor.value = before + text + after;
  renderPreview();
  scheduleeSave();
}

// Add comment button handler
addCommentBtn.addEventListener('click', () => {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;

  if (start !== end) {
    // Wrap selection with inline comment
    const before = editor.value.substring(0, start);
    const selected = editor.value.substring(start, end);
    const after = editor.value.substring(end);

    const comment = prompt('Enter comment:');
    if (comment) {
      editor.value = before +
        `<!-- comment-start: ${comment} -->` +
        selected +
        '<!-- comment-end -->' +
        after;
      renderPreview();
      scheduleeSave();
    }
  } else {
    // Insert standalone comment at cursor
    const comment = prompt('Enter comment:');
    if (comment) {
      const before = editor.value.substring(0, start);
      const after = editor.value.substring(start);
      editor.value = before + `\n<!-- comment: ${comment} -->\n` + after;
      renderPreview();
      scheduleeSave();
    }
  }
});

// Approve section button handler
approveSectionBtn.addEventListener('click', () => {
  const cursorPos = editor.selectionStart;
  const insertPos = findNearestHeading(editor.value, cursorPos);

  // Remove any existing status marker for this section first
  const lines = editor.value.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)\s*-->/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert approved status
  insertAtPosition(insertPos, '<!-- status: approved -->\n');
});

// Reject section button handler
rejectSectionBtn.addEventListener('click', () => {
  const cursorPos = editor.selectionStart;
  const insertPos = findNearestHeading(editor.value, cursorPos);

  // Remove any existing status marker for this section first
  const lines = editor.value.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)\s*-->/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert rejected status
  insertAtPosition(insertPos, '<!-- status: rejected -->\n');
});

// Export handler
exportSelect.addEventListener('change', async () => {
  const value = exportSelect.value;
  if (!value) return;

  let content;
  let filename;

  if (value === 'clean') {
    const result = await api.getCleanDocument(documentId);
    content = result.content;
    filename = documentId + '-clean.md';
  } else {
    content = editor.value;
    filename = documentId + '.md';
  }

  // Download
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  exportSelect.value = '';
});

// Back button
backButton.addEventListener('click', () => {
  window.location.href = '/';
});

// Editor input handler
editor.addEventListener('input', () => {
  renderPreview();
  scheduleeSave();
});

// Synchronized scrolling
let editorScrolling = false;
let previewScrolling = false;

editor.addEventListener('scroll', () => {
  if (previewScrolling) return;
  editorScrolling = true;

  const percentage = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
  previewPane.scrollTop = percentage * (previewPane.scrollHeight - previewPane.clientHeight);

  setTimeout(() => { editorScrolling = false; }, 50);
});

previewPane.addEventListener('scroll', () => {
  if (editorScrolling) return;
  previewScrolling = true;

  const percentage = previewPane.scrollTop / (previewPane.scrollHeight - previewPane.clientHeight);
  editor.scrollTop = percentage * (editor.scrollHeight - editor.clientHeight);

  setTimeout(() => { previewScrolling = false; }, 50);
});

// Resizer functionality
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const container = document.querySelector('.split-pane');
  const containerRect = container.getBoundingClientRect();
  const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;

  const editorPane = document.querySelector('.editor-pane');
  editorPane.style.flex = `0 0 ${Math.min(Math.max(percentage, 20), 80)}%`;
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// WebSocket handlers
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'document_updated' && message.id === documentId) {
    // Only update if content differs (avoid cursor jump)
    if (message.content !== editor.value) {
      isUpdatingFromServer = true;
      const scrollPos = editor.scrollTop;
      const cursorPos = editor.selectionStart;

      editor.value = message.content;
      renderPreview();

      editor.scrollTop = scrollPos;
      editor.selectionStart = cursorPos;
      editor.selectionEnd = cursorPos;

      setTimeout(() => { isUpdatingFromServer = false; }, 100);
    }
  }

  if (message.type === 'document_deleted' && message.id === documentId) {
    alert('This document has been deleted');
    window.location.href = '/';
  }
});

// Initialize
api.connectWebSocket();
api.subscribe(documentId);
loadDocument();
```

**Step 2: Commit**

```bash
git add public/js/document-editor.js
git commit -m "feat: add document editor JavaScript"
```

---

## Task 12: Update Dashboard for Combined View

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/dashboard.js`

**Step 1: Update index.html**

Replace the content of `public/index.html`:

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

    .item-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
    }

    .item-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }

    .delete-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(244, 67, 54, 0.9);
      color: white;
      border-radius: 50%;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s, background 0.2s;
      z-index: 10;
    }

    .item-card:hover .delete-btn {
      opacity: 1;
    }

    .delete-btn:hover {
      background: rgba(211, 47, 47, 1);
    }

    .type-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      z-index: 10;
    }

    .type-badge.diagram {
      background: #e3f2fd;
      color: #1976d2;
    }

    .type-badge.document {
      background: #f3e5f5;
      color: #7b1fa2;
    }

    .item-thumbnail {
      width: 100%;
      height: 180px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .item-thumbnail img {
      max-width: 100%;
      max-height: 100%;
    }

    .item-thumbnail.document-preview {
      padding: 16px;
      align-items: flex-start;
      font-size: 13px;
      color: #666;
      line-height: 1.5;
      text-align: left;
    }

    .item-info {
      padding: 16px;
    }

    .item-name {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .item-meta {
      font-size: 12px;
      color: #666;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }

    .filter-group select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Collaboration Dashboard</h1>
      <button id="delete-all" style="margin-left: auto; margin-right: 16px; padding: 8px 16px; border: 1px solid #f44336; background: #f44336; color: white; border-radius: 4px; cursor: pointer;">Delete All</button>
      <div class="connection-status disconnected" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </div>

    <div class="filter-group">
      <select id="type-filter">
        <option value="all">All Items</option>
        <option value="diagram">Diagrams Only</option>
        <option value="document">Documents Only</option>
      </select>
      <input
        type="text"
        class="search-box"
        placeholder="Search..."
        id="search"
        style="flex: 1;"
      >
    </div>

    <div class="diagram-grid" id="grid"></div>
    <div class="empty-state" id="empty" style="display: none;">
      No items found. Create diagrams or documents using the MCP tools!
    </div>
  </div>

  <script type="module" src="/js/api-client.js"></script>
  <script type="module" src="/js/dashboard.js"></script>
</body>
</html>
```

**Step 2: Update dashboard.js**

Replace the content of `public/js/dashboard.js`:

```javascript
import APIClient from './api-client.js';

const api = new APIClient();
let diagrams = [];
let documents = [];

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const typeFilter = document.getElementById('type-filter');
const deleteAllBtn = document.getElementById('delete-all');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Load all items
async function loadItems() {
  const [diagramsResponse, documentsResponse] = await Promise.all([
    api.getDiagrams(),
    api.getDocuments(),
  ]);

  diagrams = diagramsResponse.diagrams || [];
  documents = documentsResponse.documents || [];
  renderGrid();
}

// Get preview text for document (first ~100 chars or first heading)
function getDocumentPreview(content) {
  // Try to find first heading
  const headingMatch = content.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1];
  }

  // Fall back to first 100 chars
  const clean = content
    .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
    .replace(/^#+\s*/gm, '')         // Remove heading markers
    .trim();

  return clean.substring(0, 100) + (clean.length > 100 ? '...' : '');
}

// Render grid
function renderGrid() {
  const filter = search.value.toLowerCase();
  const typeFilterValue = typeFilter.value;

  // Combine and filter items
  let items = [];

  if (typeFilterValue === 'all' || typeFilterValue === 'diagram') {
    items.push(...diagrams.map(d => ({
      ...d,
      type: 'diagram',
      displayName: d.name.replace('.mmd', ''),
    })));
  }

  if (typeFilterValue === 'all' || typeFilterValue === 'document') {
    items.push(...documents.map(d => ({
      ...d,
      type: 'document',
      displayName: d.name.replace('.md', ''),
    })));
  }

  // Filter by search
  items = items.filter(item =>
    item.displayName.toLowerCase().includes(filter)
  );

  // Sort by lastModified (newest first)
  items.sort((a, b) => b.lastModified - a.lastModified);

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = items.map(item => {
    if (item.type === 'diagram') {
      return `
        <div class="item-card" data-id="${item.id}" data-type="diagram">
          <span class="type-badge diagram">Diagram</span>
          <button class="delete-btn" data-id="${item.id}" data-type="diagram" title="Delete">×</button>
          <div class="item-thumbnail">
            <img src="${api.getThumbnailURL(item.id)}" alt="${item.displayName}">
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="item-card" data-id="${item.id}" data-type="document">
          <span class="type-badge document">Document</span>
          <button class="delete-btn" data-id="${item.id}" data-type="document" title="Delete">×</button>
          <div class="item-thumbnail document-preview">
            ${getDocumentPreview(item.content)}
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');

  // Add click handlers for cards
  document.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;

      const id = card.dataset.id;
      const type = card.dataset.type;

      if (type === 'diagram') {
        window.location.href = `/diagram.html?id=${id}`;
      } else {
        window.location.href = `/document.html?id=${id}`;
      }
    });
  });

  // Add click handlers for delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const id = btn.dataset.id;
      const type = btn.dataset.type;

      try {
        if (type === 'diagram') {
          await api.deleteDiagram(id);
        } else {
          await api.deleteDocument(id);
        }
        await loadItems();
      } catch (error) {
        alert('Failed to delete: ' + error.message);
      }
    });
  });
}

// Delete all items
async function deleteAllItems() {
  if (!confirm('Delete all diagrams and documents?')) return;

  try {
    await Promise.all([
      ...diagrams.map(d => api.deleteDiagram(d.id)),
      ...documents.map(d => api.deleteDocument(d.id)),
    ]);
    await loadItems();
  } catch (error) {
    alert('Failed to delete: ' + error.message);
  }
}

// Event listeners
search.addEventListener('input', renderGrid);
typeFilter.addEventListener('change', renderGrid);
deleteAllBtn.addEventListener('click', deleteAllItems);

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (
    message.type === 'diagram_created' ||
    message.type === 'diagram_deleted' ||
    message.type === 'document_created' ||
    message.type === 'document_deleted'
  ) {
    loadItems();
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Initialize
api.connectWebSocket();
loadItems();
```

**Step 3: Commit**

```bash
git add public/index.html public/js/dashboard.js
git commit -m "feat: update dashboard for combined diagram/document view"
```

---

## Task 13: Add Document MCP Tools

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Add document tool functions**

Add these functions after the existing diagram functions (around line 213):

```typescript
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
```

**Step 2: Add document tools to ListToolsRequestSchema handler**

Add these tools to the tools array in the `ListToolsRequestSchema` handler:

```typescript
{
  name: 'list_documents',
  description: 'List all available documents in the system',
  inputSchema: {
    type: 'object',
    properties: {},
  },
},
{
  name: 'get_document',
  description: 'Get a specific document by its ID, including content and metadata',
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
  description: 'Create a new markdown document with the given name and content. Returns the document ID and preview URL.',
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
  description: 'Update an existing document\'s content',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The document ID to update',
      },
      content: {
        type: 'string',
        description: 'The new markdown content',
      },
    },
    required: ['id', 'content'],
  },
},
{
  name: 'preview_document',
  description: 'Get the preview URL for viewing a document in the browser',
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
```

**Step 3: Add document tool handlers to CallToolRequestSchema handler**

Add these cases to the switch statement in the `CallToolRequestSchema` handler:

```typescript
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
```

**Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add document MCP tools"
```

---

## Task 14: Create Documents Folder

**Files:**
- Create: `documents/.gitkeep`

**Step 1: Create documents folder with .gitkeep**

```bash
mkdir -p /home/qbintelligence/code/claude-mermaid-collab/documents
touch /home/qbintelligence/code/claude-mermaid-collab/documents/.gitkeep
```

**Step 2: Commit**

```bash
git add documents/.gitkeep
git commit -m "feat: add documents folder"
```

---

## Task 15: Test the Implementation

**Step 1: Start the server**

```bash
cd /home/qbintelligence/code/claude-mermaid-collab && bun run dev
```

**Step 2: Test document creation via API**

```bash
curl -X POST http://localhost:3737/api/document \
  -H "Content-Type: application/json" \
  -d '{"name":"test-doc","content":"# Test Document\n\nThis is a test.\n\n## Section 1\n\nSome content here."}'
```

Expected: `{"id":"test-doc","success":true}`

**Step 3: Test document retrieval**

```bash
curl http://localhost:3737/api/document/test-doc
```

Expected: JSON with document content

**Step 4: Open in browser**

Open `http://localhost:3737/document.html?id=test-doc`

Verify:
- Split pane with editor on left, preview on right
- Markdown renders correctly
- Comment button works
- Approve/Reject buttons insert markers
- Export works

**Step 5: Test dashboard**

Open `http://localhost:3737/`

Verify:
- Filter dropdown shows "All Items", "Diagrams Only", "Documents Only"
- Document cards appear with purple badge
- Document preview shows first ~100 chars
- Clicking document opens document editor

**Step 6: Commit final verification**

```bash
git add -A
git commit -m "test: verify document collaboration implementation"
```

---

## Summary

This implementation adds collaborative text documents to the Mermaid server:

1. **Types & Config** - Document interfaces and folder configuration
2. **DocumentManager** - CRUD service mirroring DiagramManager
3. **WebSocket** - Document events for real-time sync
4. **File Watcher** - Watches both diagrams and documents folders
5. **API Routes** - REST endpoints for documents
6. **Server** - Wires everything together
7. **API Client** - Client-side document methods
8. **Document Editor** - Split-pane markdown editor with comment/status features
9. **Dashboard** - Combined view with filter dropdown
10. **MCP Tools** - Claude integration for documents
