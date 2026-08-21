import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const storePath = new URL('../../ios/MermaidCollab/Sources/Store.swift', import.meta.url);
const coreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/KeychainServerTokenStoreTests.swift',
  import.meta.url
);
const registryCoreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/ServerRegistryStoreTests.swift',
  import.meta.url
);

describe('ios app wiring', () => {
  it('1. Store.swift assigns a Keychain-backed tokenStore', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toMatch(/tokenStore[^\n]*=[^\n]*Keychain/);
  });

  it('2. Store.swift references ServerTokenStore', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('ServerTokenStore');
  });

  it('3. Core KeychainServerTokenStoreTests declares both numbered cases', () => {
    const coreTest = readFileSync(coreTestPath, 'utf8');
    expect(coreTest).toContain('test1_');
    expect(coreTest).toContain('test2_');
  });

  it('4. Store.swift names the registry persistence type at its registry property', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('ServerRegistryPersisting');
    expect(store).not.toMatch(/var registry\s*=\s*ServerRegistry\(entries:\s*\[/);
  });

  it('5. Core ServerRegistryStoreTests declares the three numbered cases', () => {
    const registryCoreTest = readFileSync(registryCoreTestPath, 'utf8');
    expect(registryCoreTest).toContain('test1_');
    expect(registryCoreTest).toContain('test2_');
    expect(registryCoreTest).toContain('test3_');
  });
});
