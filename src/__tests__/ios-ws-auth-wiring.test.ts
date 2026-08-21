/**
 * The iOS WebSocket upgrade must carry the bearer token.
 *
 * `URLSession.webSocketTask(with: URL)` cannot set headers, so /ws arrived with no
 * Authorization and the server rejected it — the sidecar logged
 * `REJECTED bad-token path=/ws sent=absent` while every HTTP call on the same
 * credentials returned 200 (2026-08-21). `connected` is driven by that socket, so the
 * app showed "can't reach the server" while fully authenticated for everything else.
 * Loopback is exempt from the token gate, which is why the simulator never caught it.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE = readFileSync(
  join(import.meta.dir, '..', '..', 'ios', 'MermaidCollab', 'Sources', 'Store.swift'),
  'utf8',
);

describe('iOS WebSocket auth wiring', () => {
  it('builds the socket from a URLRequest, not a bare URL', () => {
    expect(STORE).toContain('webSocketTask(with: wsRequest)');
  });

  it('the socket request sets an Authorization header', () => {
    const block = STORE.slice(STORE.indexOf('private var wsRequest'));
    expect(block.slice(0, 400)).toContain('forHTTPHeaderField: "Authorization"');
  });

  it('the socket bearer comes from the same token source the HTTP path uses', () => {
    const block = STORE.slice(STORE.indexOf('private var wsRequest'));
    expect(block.slice(0, 400)).toContain('tokenStore.token(forServerId: selectedServerId)');
  });
});
