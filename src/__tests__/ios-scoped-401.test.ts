/**
 * A 401 from a NON-selected server must not unpair the app.
 *
 * The fleet poll calls every registry entry. When the desktop advertised trimaxion with
 * the Mac's token, that one peer's 401 ran onUnauthorized and tore down the whole
 * pairing — the phone bounced to the pairing screen in a loop while the Mac it was
 * actually paired to was answering fine (2026-08-21).
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE = readFileSync(
  join(import.meta.dir, '..', '..', 'ios', 'MermaidCollab', 'Sources', 'Store.swift'),
  'utf8',
);

describe('iOS scoped 401 handling', () => {
  it('send() takes the server the request was aimed at', () => {
    expect(STORE).toContain('private func send(_ req: URLRequest, serverId: String? = nil)');
  });

  it('only the selected server\'s 401 triggers re-pair', () => {
    const block = STORE.slice(STORE.indexOf('private func send('));
    expect(block.slice(0, 700)).toContain('serverId != selectedServerId');
    expect(block.slice(0, 700)).toContain('markUnauthorized(serverId)');
  });

  it('a non-selected 401 marks that entry unauthorized', () => {
    const block = STORE.slice(STORE.indexOf('private func markUnauthorized'));
    expect(block.slice(0, 300)).toContain('reachability = .unauthorized');
  });

  it('the fleet polls pass their own server id so their 401s stay scoped', () => {
    expect(STORE).toContain('path: "/api/supervisor/escalations?status=open"), serverId: entry.id)');
    expect(STORE).toContain('path: "/api/supervisor/projects"), serverId: entry.id)');
  });
});
