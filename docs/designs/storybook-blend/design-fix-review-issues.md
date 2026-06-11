# Design Document: Fix Review Issues

## Overview

This document specifies exact fixes for all confirmed bugs and gaps found during the bug and completeness reviews of the embed feature implementation.

---

## Bug 1 (Critical): `embedManager.create()` return value mishandled

**File:** `src/routes/api.ts` line 1977
**Status:** CONFIRMED

`embedManager.create()` returns a full `Embed` object (see `src/services/embed-manager.ts:41` — `Promise<Embed>`), but the result is assigned to `const id`. This means:
- `id` is actually the entire Embed object `{ id, name, url, subtype, width, height, createdAt, storybook }`
- The WebSocket broadcast at line 1981 sends `id: <entire Embed object>` instead of the string ID
- The API response at line 1989 returns `{ id: <entire Embed object>, success: true }`
- The MCP tool handler at `src/mcp/tools/embed.ts:115` reads `data.id` from the response, which would get the Embed object instead of a string

### Fix

**File:** `src/routes/api.ts` lines 1977-1989

Old code:
```typescript
      const id = await embedManager.create({ name, url: embedUrl, subtype, width, height, storybook });

      wsHandler.broadcast({
        type: 'embed_created',
        id,
        name,
        url: embedUrl,
        createdAt: new Date().toISOString(),
        project: params.project,
        session: params.session,
      });

      return Response.json({ id, success: true });
```

New code:
```typescript
      const embed = await embedManager.create({ name, url: embedUrl, subtype, width, height, storybook });

      wsHandler.broadcast({
        type: 'embed_created',
        id: embed.id,
        name,
        url: embedUrl,
        createdAt: embed.createdAt,
        project: params.project,
        session: params.session,
      });

      return Response.json({ id: embed.id, success: true });
```

**Notes:** This fix also resolves Bug 5 (using `embed.createdAt` instead of `new Date()`).

---

## Bug 2 (Important): Storybook destructuring type mismatch

**File:** `src/routes/api.ts` lines 1962-1969
**Status:** CONFIRMED — type annotation is wrong but runtime behavior is OK

The request body type annotation declares `storybook?: boolean` (line 1968), but the actual data sent by `handleCreateEmbed` in `src/mcp/tools/embed.ts:101` passes `storybook` as `{ storyId: string; port: number }`. The `EmbedManager.create()` method at `src/services/embed-manager.ts:40` also expects `storybook?: { storyId: string; port: number }`.

The `as` cast means this doesn't cause a runtime error — the object passes through correctly — but the type annotation is misleading and could cause confusion.

### Fix

**File:** `src/routes/api.ts` lines 1962-1969

Old code:
```typescript
    const { name, url: embedUrl, subtype, width, height, storybook } = await req.json() as {
      name?: string;
      url?: string;
      subtype?: string;
      width?: number;
      height?: number;
      storybook?: boolean;
    };
```

New code:
```typescript
    const { name, url: embedUrl, subtype, width, height, storybook } = await req.json() as {
      name?: string;
      url?: string;
      subtype?: string;
      width?: string;
      height?: string;
      storybook?: { storyId: string; port: number };
    };
```

**Notes:** This also fixes the `width`/`height` types from `number` to `string`, aligning with the `Embed` interface in `src/types.ts:86-87` where they are typed as `string`. This is related to Bug 3.

---

## Bug 3 (Important): Schema types for width/height don't match interface

**File:** `src/mcp/tools/embed.ts` lines 54-55
**Status:** CONFIRMED

The MCP schema declares `width` and `height` as `type: 'number'`, but the `Embed` interface in both `src/types.ts:86-87` and `ui/src/types/embed.ts:15-16` types them as `string`. The `EmbedManager.create()` parameter types at `src/services/embed-manager.ts:39` also use `string`.

### Fix

**File:** `src/mcp/tools/embed.ts` lines 54-55

Old code:
```typescript
    width: { type: 'number', description: 'Optional width in pixels for the embed' },
    height: { type: 'number', description: 'Optional height in pixels for the embed' },
```

New code:
```typescript
    width: { type: 'string', description: 'Optional width for the embed (e.g. "800", "100%")' },
    height: { type: 'string', description: 'Optional height for the embed (e.g. "600", "100%")' },
```

Also update the `handleCreateEmbed` function signature at lines 94-95:

Old code:
```typescript
  width?: number,
  height?: number,
```

New code:
```typescript
  width?: string,
  height?: string,
```

---

## Bug 4 (Important): `session` missing from `required` arrays

**File:** `src/mcp/tools/embed.ts` lines 65, 82
**Status:** NOT A BUG — matches established pattern

After reviewing other schemas in the codebase:
- `createSnippetSchema` requires only `['project']` (line 83 of snippet.ts)
- `createDesignSchema` requires `['project', 'name', 'content']` (line 73 of design.ts)
- `deleteDesignSchema` would follow similar pattern

The `sessionParamsDesc` includes both `session` and `todoId` with descriptions saying "Either session or todoId is required." The MCP setup code at `src/mcp/setup.ts:2100-2104` resolves `todoId` to `session` at runtime. Making `session` required would break the `todoId` alternative.

**No fix needed.** The current `required` arrays are correct:
- `createEmbedSchema`: `['project', 'name', 'url']` — correct
- `deleteEmbedSchema`: `['project', 'id']` — correct

---

## Bug 5 (Minor): Broadcast uses `new Date()` instead of persisted `createdAt`

**File:** `src/routes/api.ts` line 1984
**Status:** CONFIRMED — resolved by Bug 1 fix

The broadcast creates a new `Date` instead of using the `createdAt` from the persisted embed object. This could cause a mismatch between the WebSocket event timestamp and the actual stored value.

**Fix:** Already included in the Bug 1 fix above — using `embed.createdAt` instead of `new Date().toISOString()`.

---

## Gap 1: Missing `embed-manager.test.ts`

**File:** `src/services/__tests__/embed-manager.test.ts` (to create)
**Status:** CONFIRMED — file does not exist

Other service managers have test files in `src/services/__tests__/` (e.g., `status-manager.test.ts`, `snippet-manager.test.ts`, `ui-manager.test.ts`). Tests use vitest.

### Test File Design

```typescript
/**
 * Embed Manager Test Suite
 * Verifies CRUD operations for embed resources
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbedManager } from '../embed-manager';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EmbedManager', () => {
  let manager: EmbedManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'embed-test-'));
    manager = new EmbedManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create an embed and return full Embed object', async () => {
      const embed = await manager.create({
        name: 'Test Embed',
        url: 'http://localhost:6006/iframe.html',
      });

      expect(embed.id).toBe('test-embed');
      expect(embed.name).toBe('Test Embed');
      expect(embed.url).toBe('http://localhost:6006/iframe.html');
      expect(embed.createdAt).toBeDefined();
    });

    it('should reject URLs without http/https', async () => {
      await expect(
        manager.create({ name: 'Bad', url: 'ftp://example.com' })
      ).rejects.toThrow('URL must start with http://');
    });

    it('should deduplicate IDs with suffix', async () => {
      const first = await manager.create({ name: 'Dup', url: 'http://a.com' });
      const second = await manager.create({ name: 'Dup', url: 'http://b.com' });

      expect(first.id).toBe('dup');
      expect(second.id).toBe('dup-1');
    });

    it('should persist storybook metadata', async () => {
      const embed = await manager.create({
        name: 'SB',
        url: 'http://localhost:6006/iframe.html?id=test',
        subtype: 'storybook',
        storybook: { storyId: 'test', port: 6006 },
      });

      expect(embed.subtype).toBe('storybook');
      expect(embed.storybook).toEqual({ storyId: 'test', port: 6006 });
    });
  });

  describe('list', () => {
    it('should return all embeds sorted by createdAt desc', async () => {
      await manager.create({ name: 'A', url: 'http://a.com' });
      await manager.create({ name: 'B', url: 'http://b.com' });

      const embeds = await manager.list();
      expect(embeds).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should retrieve embed by ID', async () => {
      await manager.create({ name: 'Find Me', url: 'http://find.com' });
      const embed = await manager.get('find-me');

      expect(embed).not.toBeNull();
      expect(embed!.name).toBe('Find Me');
    });

    it('should return null for unknown ID', async () => {
      const embed = await manager.get('nonexistent');
      expect(embed).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove embed', async () => {
      await manager.create({ name: 'Delete Me', url: 'http://del.com' });
      await manager.delete('delete-me');

      expect(manager.hasEmbed('delete-me')).toBe(false);
    });

    it('should throw for unknown ID', async () => {
      await expect(manager.delete('nope')).rejects.toThrow('Embed not found');
    });
  });

  describe('initialize', () => {
    it('should reload index from disk', async () => {
      await manager.create({ name: 'Persist', url: 'http://p.com' });

      const manager2 = new EmbedManager(tempDir);
      await manager2.initialize();

      expect(manager2.hasEmbed('persist')).toBe(true);
      expect(manager2.getIndexSize()).toBe(1);
    });
  });
});
```

---

## Gap 3: UI API client URLs don't match server routes

**File:** `ui/src/api/embeds.ts`
**Status:** CONFIRMED

The UI client uses:
- `GET /api/sessions/{session}/embeds?project={project}` (line 22)
- `DELETE /api/sessions/{session}/embeds/{id}?project={project}` (line 45)

The server routes (confirmed in `src/routes/api.ts`) use:
- `GET /api/embeds?project=...&session=...` (line 1996)
- `DELETE /api/embed/{id}?project=...&session=...` (line 2011-2012, regex: `/^\/api\/embed\/[^/]+$/`)

### Fix

**File:** `ui/src/api/embeds.ts`

Old code (fetchEmbeds, lines 18-33):
```typescript
  async fetchEmbeds(session: string, project: string): Promise<Embed[]> {
    try {
      const encodedProject = encodeURIComponent(project);
      const response = await fetch(
        `${API_BASE}/api/sessions/${session}/embeds?project=${encodedProject}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch embeds: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embeds || [];
    } catch (error) {
      throw error;
    }
  },
```

New code (fetchEmbeds):
```typescript
  async fetchEmbeds(session: string, project: string): Promise<Embed[]> {
    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(
        `${API_BASE}/api/embeds?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch embeds: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embeds || [];
    } catch (error) {
      throw error;
    }
  },
```

Old code (deleteEmbed, lines 41-57):
```typescript
  async deleteEmbed(session: string, id: string, project: string): Promise<void> {
    try {
      const encodedProject = encodeURIComponent(project);
      const response = await fetch(
        `${API_BASE}/api/sessions/${session}/embeds/${id}?project=${encodedProject}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to delete embed: ${response.statusText}`);
      }
    } catch (error) {
      throw error;
    }
  },
```

New code (deleteEmbed):
```typescript
  async deleteEmbed(session: string, id: string, project: string): Promise<void> {
    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(
        `${API_BASE}/api/embed/${id}?${params.toString()}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to delete embed: ${response.statusText}`);
      }
    } catch (error) {
      throw error;
    }
  },
```

---

## Fix Interaction Map

| Fix | Depends On | Affects |
|-----|-----------|---------|
| Bug 1 (create return value) | None | Resolves Bug 5. Fixes broadcast + API response. |
| Bug 2 (type annotation) | None | Cosmetic/type-safety only. |
| Bug 3 (schema types) | None | Must align with Bug 2 fix (both use string for width/height). |
| Bug 4 | N/A | No fix needed — verified as correct pattern. |
| Bug 5 (createdAt) | Bug 1 | Resolved by Bug 1 fix. |
| Gap 1 (tests) | All bugs | Should be written after bug fixes are applied. |
| Gap 3 (API URLs) | None | Independent — UI client only. |

## Execution Order

1. **Bug 1 + Bug 5** — Fix `src/routes/api.ts` (critical, single change)
2. **Bug 2** — Fix type annotation in same file (can batch with #1)
3. **Bug 3** — Fix `src/mcp/tools/embed.ts` schema and handler types
4. **Gap 3** — Fix `ui/src/api/embeds.ts` URL paths
5. **Gap 1** — Create `src/services/__tests__/embed-manager.test.ts`
