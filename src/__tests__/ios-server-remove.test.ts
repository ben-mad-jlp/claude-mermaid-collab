/**
 * The fleet picker must be able to FORGET a server.
 *
 * It could add and switch but never remove, so a mis-scanned or retired machine stayed in
 * the registry forever and kept being polled — and there was no way back to a clean slate
 * short of deleting the app (2026-08-21).
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) =>
  readFileSync(join(import.meta.dir, '..', '..', 'ios', 'MermaidCollab', 'Sources', f), 'utf8');
const STORE = src('Store.swift');
const PICKER = src('ServerPickerView.swift');

describe('iOS server removal', () => {
  it('a row offers a destructive swipe action', () => {
    expect(PICKER).toContain('.swipeActions(');
    expect(PICKER).toContain('store.removeServer(row.id)');
  });

  it('removing a server also drops its saved token', () => {
    const block = STORE.slice(STORE.indexOf('func removeServer('));
    expect(block.slice(0, 900)).toContain('tokenStore.removeToken(forServerId: serverId)');
  });

  it('removing the SELECTED server moves the selection and reconnects', () => {
    const block = STORE.slice(STORE.indexOf('func removeServer('));
    expect(block.slice(0, 900)).toContain('registry.entries.first');
    expect(block.slice(0, 900)).toContain('start()');
  });

  it('removing the last server leaves the app unpaired rather than pointing at nothing', () => {
    const block = STORE.slice(STORE.indexOf('func removeServer('));
    expect(block.slice(0, 900)).toContain('connected = false');
  });

  it('remove-all clears every token, not just the entries', () => {
    const block = STORE.slice(STORE.indexOf('func removeAllServers('));
    expect(block.slice(0, 700)).toContain('for entry in registry.entries { tokenStore.removeToken(');
    expect(block.slice(0, 700)).toContain('registry.entries.removeAll()');
  });

  it('remove-all confirms first, because it is irreversible', () => {
    expect(PICKER).toContain('confirmationDialog(');
    expect(PICKER).toContain('remove-all-servers-button');
    expect(PICKER).toContain('store.removeAllServers()');
  });
});
