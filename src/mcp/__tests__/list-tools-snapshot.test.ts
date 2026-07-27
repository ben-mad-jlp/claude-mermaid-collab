import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupMCPServer } from '../setup.js';

// Canonicalize: recursively sort object keys alphabetically, preserve array order
function canonicalize(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sorted: Record<string, any> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sorted[key] = canonicalize(value[key]);
  }
  return sorted;
}

describe('ListTools snapshot', () => {
  it('should match the committed snapshot (byte-identical list)', async () => {
    // Setup the server and get the handler
    const server = await setupMCPServer();
    const handler = (server as any)._requestHandlers.get('tools/list');

    if (!handler) {
      throw new Error('tools/list handler not found');
    }

    // Invoke the handler
    const actual = await handler({ method: 'tools/list', params: {} }, {} as any);

    // Load the committed fixture
    const fixturePath = join(import.meta.dir, '__fixtures__', 'list-tools.snapshot.json');
    const fixtureContent = readFileSync(fixturePath, 'utf8');
    const expected = JSON.parse(fixtureContent);

    // Assert tool name order explicitly (separate check for clarity)
    const actualNames = actual.tools.map((t: any) => t.name);
    const expectedNames = expected.tools.map((t: any) => t.name);
    expect(actualNames).toEqual(expectedNames);

    // Assert canonicalized deep equality
    expect(canonicalize(actual)).toEqual(canonicalize(expected));
  });
});
