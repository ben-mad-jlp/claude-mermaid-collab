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
const serverPickerViewPath = new URL('../../ios/MermaidCollab/Sources/ServerPickerView.swift', import.meta.url);
const serverPickerRowCoreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/ServerPickerRowTests.swift',
  import.meta.url
);
const escalationMergeCoreTestPath = new URL(
  '../../ios/MermaidCollabCore/Tests/MermaidCollabCoreTests/EscalationMergeTests.swift',
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

  it('11. ServerPickerView.swift names the registry entries and the reachability property', () => {
    const serverPickerView = readFileSync(serverPickerViewPath, 'utf8');
    expect(serverPickerView).toContain('registry.entries');
    expect(serverPickerView).toContain('reachability');
    const serverPickerRowCoreTest = readFileSync(serverPickerRowCoreTestPath, 'utf8');
    expect(serverPickerRowCoreTest).toContain('test1_');
    expect(serverPickerRowCoreTest).toContain('test2_');
    expect(serverPickerRowCoreTest).toContain('test3_');
  });

  it('12. Store.swift routes the escalation decide path through a server id taken from the card', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('EscalationMerge.decideRoute');
    expect(store).not.toMatch(/serverId: selectedServerId, path: "\/api\/supervisor\/escalation/);
    const escalationMergeCoreTest = readFileSync(escalationMergeCoreTestPath, 'utf8');
    expect(escalationMergeCoreTest).toContain('test1_');
    expect(escalationMergeCoreTest).toContain('test2_');
  });

  it('13. Store.swift fetches the mission diagnostic endpoint', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('/api/supervisor/missions/diagnostic');
    expect(store).toContain('fetchMissionDiagnostic');
  });

  it('14. Store.swift fetches the bridge snapshot endpoint', () => {
    const store = readFileSync(storePath, 'utf8');
    expect(store).toContain('/api/supervisor/bridge-snapshot');
    expect(store).toContain('fetchBridgeSnapshot');
    expect(store).toContain('BridgeSnapshotResponse');
  });
});
