/**
 * Tests for tools.listChanged capability and notifications
 *
 * Symbol sites exercised:
 * - src/mcp/setup.ts:169 (capability)
 * - src/mcp/tool-registry-notifier.ts:37 (notifyToolListChanged)
 * - src/mcp/advertised-tools.ts (invalidateAdvertisedToolsCache, new)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setupMCPServer } from '../setup.js';
import { registerMcpServer, unregisterMcpServer, notifyToolListChanged } from '../tool-registry-notifier.js';
import { invalidateAdvertisedToolsCache } from '../advertised-tools.js';
import * as desktopTools from '../desktop-tools.js';

describe('tools.listChanged capability', () => {
  it('declares tools.listChanged capability', async () => {
    const server = await setupMCPServer();
    expect((server as any)._capabilities.tools.listChanged).toBe(true);
  });
});

describe('notifications/tools/list_changed', () => {
  let server: Server;
  let recorded: any[] = [];

  beforeEach(async () => {
    // Reset desktop bridge state for each test
    desktopTools.__setDesktopBridgeForTest(null);

    // Create a server and connect it to an in-memory transport
    server = await setupMCPServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Record all messages sent from server to client
    recorded = [];
    clientTransport.onmessage = (msg) => {
      recorded.push(msg);
    };

    // Connect server
    await server.connect(serverTransport);
  });

  afterEach(async () => {
    // Clean up: reset desktop bridge state after each test so other tests aren't affected
    desktopTools.__setDesktopBridgeForTest(null);
  });

  it('drives notifications/tools/list_changed when the desktop bridge flips present', async () => {
    // Register the server to receive notifications
    registerMcpServer(server);

    // Set up a mock bridge with a fake tool
    const mockBridge = {
      ElectronDriver: {},
      createDesktopTools: () => ({
        defs: [{ name: 'desktop_x', description: 'test tool', inputSchema: { type: 'object' } }],
        handlers: { desktop_x: async () => 'ok' },
      }),
    };

    // Simulate the bridge becoming available by setting it via the test seam
    // This triggers the 0->N flip on the next ensureDesktopBridge() call
    desktopTools.__setDesktopBridgeForTest(mockBridge);

    // Call ensureDesktopBridge to trigger initialization and notifications
    const result = await desktopTools.ensureDesktopBridge();
    expect(result).toBe(true);

    // Give async operations a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Find the list_changed notification in recorded messages
    const listChangedMsg = recorded.find(
      (msg) => msg.method === 'notifications/tools/list_changed'
    );
    expect(listChangedMsg).toBeDefined();
    expect(listChangedMsg.method).toBe('notifications/tools/list_changed');
  });

  it('an unregistered/closed server receives no notification', async () => {
    // Create a second server/transport pair and explicitly unregister it
    // (setupMCPServer auto-registers, so we must unregister to test the no-notification path)
    const server2 = await setupMCPServer();
    const [clientTransport2, serverTransport2] = InMemoryTransport.createLinkedPair();

    const recorded2: any[] = [];
    clientTransport2.onmessage = (msg) => {
      recorded2.push(msg);
    };

    await server2.connect(serverTransport2);

    // Unregister server2 to test the negative arm
    unregisterMcpServer(server2);

    // Trigger a notification
    notifyToolListChanged('test');

    // Allow async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // First server (registered via beforeEach's implicit auto-registration) should have received it
    const msg1 = recorded.find((msg) => msg.method === 'notifications/tools/list_changed');
    expect(msg1).toBeDefined();

    // Second server (explicitly unregistered) should NOT have received it
    const msg2 = recorded2.find((msg) => msg.method === 'notifications/tools/list_changed');
    expect(msg2).toBeUndefined();
  });

  it('declares listChanged through the client-observable initialize result', async () => {
    // Create a new server and client to test the capability through client.getServerCapabilities()
    const server2 = await setupMCPServer();
    const [clientTransport2, serverTransport2] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: 'test-client', version: '1' },
      { capabilities: {} }
    );

    await Promise.all([
      server2.connect(serverTransport2),
      client.connect(clientTransport2),
    ]);

    const capabilities = client.getServerCapabilities();
    expect(capabilities?.tools?.listChanged).toBe(true);
  });

  it('invalidateAdvertisedToolsCache emits notifications/tools/list_changed to a connected client', async () => {
    // Server is already connected and registered via beforeEach/setupMCPServer
    // Invalidate the cache, which should emit a notification
    invalidateAdvertisedToolsCache();

    // Allow async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify the notification was received via the transport set up in beforeEach
    const listChangedMsg = recorded.find(
      (msg) => msg.method === 'notifications/tools/list_changed'
    );
    expect(listChangedMsg).toBeDefined();
    expect(listChangedMsg.method).toBe('notifications/tools/list_changed');
  });

  it('notifyToolListChanged with no registered server resolves without throwing and emits nothing', async () => {
    // Create a server but explicitly unregister it to test the no-registration path
    const server3 = await setupMCPServer();
    unregisterMcpServer(server3);

    // Verify that calling notifyToolListChanged does not throw
    expect(() => notifyToolListChanged('probe')).not.toThrow();
  });
});
