/**
 * The fleet picker must be REACHABLE and able to act.
 *
 * ServerPickerView shipped read-only and unreferenced: the registry could hold several
 * servers, but nothing in the app could switch between them or add another, so a phone
 * pairing a second machine had no way to see it (2026-08-21). These assertions pin the
 * three things that made it inert — no entry point, no selection write, no add path.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) =>
  readFileSync(join(import.meta.dir, '..', '..', 'ios', 'MermaidCollab', 'Sources', f), 'utf8');

const VIEWS = src('Views.swift');
const PICKER = src('ServerPickerView.swift');
const STORE = src('Store.swift');

describe('iOS server picker wiring', () => {
  it('the main view presents the picker', () => {
    expect(VIEWS).toContain('ServerPickerView()');
    expect(VIEWS).toContain('server-picker-button');
  });

  it('a row selects that server', () => {
    expect(PICKER).toContain('store.selectServer(row.id)');
  });

  it('the picker offers a way to add another server by scanning', () => {
    expect(PICKER).toContain('add-server-button');
    expect(PICKER).toContain('QRScannerView');
    expect(PICKER).toContain('app.handle(scanned:');
  });

  it('selecting a server restores THAT server bearer and restarts the socket', () => {
    const block = STORE.slice(STORE.indexOf('func selectServer('));
    expect(block.slice(0, 800)).toContain('tokenStore.token(forServerId: serverId)');
    expect(block.slice(0, 800)).toContain('stop()');
    expect(block.slice(0, 800)).toContain('start()');
  });

  it('scanning MERGES into the registry rather than replacing it', () => {
    const pairing = src('Pairing.swift');
    expect(pairing).toContain('registry.merging(payload)');
  });
});
