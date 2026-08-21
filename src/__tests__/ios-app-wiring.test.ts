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
const mappingCoreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/ServerProjectsMappingTests.swift',
  import.meta.url
);
const pairingPath = new URL('../../ios/MermaidCollab/Sources/Pairing.swift', import.meta.url);
const pairingImportCoreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/PairingImportTests.swift',
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

  it('6. Store.swift polls the supervisor projects endpoint', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('/api/supervisor/projects');
  });

  it('7. Store.swift assigns projectsByServerId', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toMatch(/projectsByServerId\s*=/);
  });

  it('8. Core ServerProjectsMappingTests declares its numbered case', () => {
    const mappingCoreTest = readFileSync(mappingCoreTestPath, 'utf8');
    expect(mappingCoreTest).toContain('test1_twoServersYieldOneKeyEachWithTheirOwnProjects');
  });

  it('9. Pairing.swift merges a parsed payload into the registry', () => {
    const pairing = readFileSync(pairingPath, 'utf8');
    expect(pairing).toMatch(/registry\s*=\s*[^\n]*\.merging\(/);
    expect(pairing).toContain('parsePayload');
  });

  it('10. Core PairingImportTests declares the three numbered cases', () => {
    const pairingImportCoreTest = readFileSync(pairingImportCoreTestPath, 'utf8');
    expect(pairingImportCoreTest).toContain('test1_');
    expect(pairingImportCoreTest).toContain('test2_');
    expect(pairingImportCoreTest).toContain('test3_');
  });
});
