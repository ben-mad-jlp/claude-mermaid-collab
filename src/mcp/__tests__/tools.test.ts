/**
 * Integration tests for alias management MCP tools
 *
 * Tests cover:
 * - kodex_add_alias tool registration and execution
 * - kodex_remove_alias tool registration and execution
 * - Tool schemas validation
 * - Error handling for invalid inputs
 * - Error handling for missing topics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupMCPServer } from '../setup.js';
import { getKodexManager } from '../../services/kodex-manager.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ============================================================================
// TEST SETUP
// ============================================================================

let server: Server;
let testProjectDir: string;

beforeEach(async () => {
  // Create a temporary test project directory
  testProjectDir = join(tmpdir(), `kodex-test-${Date.now()}`);
  mkdirSync(testProjectDir, { recursive: true });

  // Initialize the server
  server = await setupMCPServer();

  // Set up test topic
  const kodex = getKodexManager(testProjectDir);
  await kodex.createTopic(
    'test-topic',
    'Test Topic',
    {
      conceptual: 'Test concept',
      technical: 'Test technical details',
      files: 'test.ts',
      related: 'other-topic'
    },
    'test-user'
  );
});

afterEach(() => {
  // Clean up test directory
  if (testProjectDir) {
    rmSync(testProjectDir, { recursive: true, force: true });
  }
});

// ============================================================================
// TOOL REGISTRATION TESTS
// ============================================================================

describe('Alias Management Tools Registration', () => {
  it('should list all available tools including kodex_add_alias', async () => {
    const toolsHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema);
    if (!toolsHandler) {
      throw new Error('Tools handler not found');
    }
    const result = await toolsHandler({} as any);
    const tools = result.tools as any[];
    const addAliasTool = tools.find(t => t.name === 'kodex_add_alias');
    expect(addAliasTool).toBeDefined();
    expect(addAliasTool?.description).toContain('alias');
  });

  it('should list all available tools including kodex_remove_alias', async () => {
    const toolsHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema);
    if (!toolsHandler) {
      throw new Error('Tools handler not found');
    }
    const result = await toolsHandler({} as any);
    const tools = result.tools as any[];
    const removeAliasTool = tools.find(t => t.name === 'kodex_remove_alias');
    expect(removeAliasTool).toBeDefined();
    expect(removeAliasTool?.description).toContain('alias');
  });
});

// ============================================================================
// TOOL SCHEMA VALIDATION TESTS
// ============================================================================

describe('Alias Management Tool Schemas', () => {
  it('should have correct schema for kodex_add_alias', async () => {
    const toolsHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema);
    const result = await toolsHandler({} as any);
    const tools = result.tools as any[];
    const addAliasTool = tools.find(t => t.name === 'kodex_add_alias');

    expect(addAliasTool?.inputSchema).toEqual({
      type: 'object',
      properties: expect.objectContaining({
        project: expect.any(Object),
        topicName: expect.any(Object),
        alias: expect.any(Object),
      }),
      required: expect.any(Array),
    });

    expect(addAliasTool?.inputSchema.required).toContain('project');
    expect(addAliasTool?.inputSchema.required).toContain('topicName');
    expect(addAliasTool?.inputSchema.required).toContain('alias');
  });

  it('should have correct schema for kodex_remove_alias', async () => {
    const toolsHandler = (server as any)._requestHandlers.get(ListToolsRequestSchema);
    const result = await toolsHandler({} as any);
    const tools = result.tools as any[];
    const removeAliasTool = tools.find(t => t.name === 'kodex_remove_alias');

    expect(removeAliasTool?.inputSchema).toEqual({
      type: 'object',
      properties: expect.objectContaining({
        project: expect.any(Object),
        topicName: expect.any(Object),
        alias: expect.any(Object),
      }),
      required: expect.any(Array),
    });

    expect(removeAliasTool?.inputSchema.required).toContain('project');
    expect(removeAliasTool?.inputSchema.required).toContain('topicName');
    expect(removeAliasTool?.inputSchema.required).toContain('alias');
  });
});

// ============================================================================
// TOOL EXECUTION TESTS
// ============================================================================

describe('kodex_add_alias Tool Execution', () => {
  it('should add an alias to a topic with valid inputs', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text;
    expect(text).toContain('successfully');
  });

  it('should return error for missing project parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          topicName: 'test-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error for missing topicName parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          project: testProjectDir,
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error for missing alias parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error when topic does not exist', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'non-existent-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Topic not found');
  });
});

describe('kodex_remove_alias Tool Execution', () => {
  it('should remove an alias from a topic with valid inputs', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    // First add an alias
    await toolHandler({
      params: {
        name: 'kodex_add_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    // Then remove it
    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text;
    expect(text).toContain('successfully');
  });

  it('should return error for missing project parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          topicName: 'test-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error for missing topicName parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          project: testProjectDir,
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error for missing alias parameter', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Missing required');
  });

  it('should return error when topic does not exist', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'non-existent-topic',
          alias: 'test-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Topic not found');
  });

  it('should return error when alias does not exist', async () => {
    const toolHandler = (server as any)._requestHandlers.get(CallToolRequestSchema);
    if (!toolHandler) {
      throw new Error('Tool handler not found');
    }

    const result = await toolHandler({
      params: {
        name: 'kodex_remove_alias',
        arguments: {
          project: testProjectDir,
          topicName: 'test-topic',
          alias: 'non-existent-alias',
        },
      },
    } as any);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text;
    expect(text).toContain('Alias not found');
  });
});
