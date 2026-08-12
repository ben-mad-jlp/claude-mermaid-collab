import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;

export const ARTIFACT_TYPES = [
  'document',
  'diagram',
  'design',
  'spreadsheet',
  'snippet',
  'image',
] as const;

export type ArtifactKind = typeof ARTIFACT_TYPES[number];

export interface ArtifactEnvelope {
  schemaVersion: 1;
  envelopeId: string;
  receivedAt: string;
  from: {
    serverOwner?: string;
    baseUrl?: string;
    project?: string;
    session?: string;
    note?: string;
  };
  artifact: {
    type: ArtifactKind;
    name: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  historyNote?: string;
  state: 'pending' | 'adopted' | 'dismissed';
  adoptedTo?: string;
}

export function inboxDir(): string {
  return (
    process.env.MERMAID_ARTIFACT_INBOX_DIR ??
    join(homedir(), '.mermaid-collab', 'artifact-inbox')
  );
}

export function writeEnvelope(input: Omit<ArtifactEnvelope, 'schemaVersion' | 'envelopeId' | 'receivedAt' | 'state'>): ArtifactEnvelope {
  mkdirSync(inboxDir(), { recursive: true });

  const envelope: ArtifactEnvelope = {
    ...input,
    schemaVersion: 1,
    envelopeId: randomUUID(),
    receivedAt: new Date().toISOString(),
    state: 'pending',
  };

  const filePath = join(inboxDir(), `${envelope.envelopeId}.json`);
  writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8');

  return readEnvelope(envelope.envelopeId)!;
}

export function readEnvelope(envelopeId: string): ArtifactEnvelope | null {
  if (!/^[0-9a-fA-F-]{36}$/.test(envelopeId)) {
    return null;
  }

  try {
    const filePath = join(inboxDir(), `${envelopeId}.json`);
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as ArtifactEnvelope;
  } catch {
    return null;
  }
}

export function listEnvelopes(): ArtifactEnvelope[] {
  try {
    const dir = inboxDir();
    const files = readdirSync(dir);
    const envelopes: ArtifactEnvelope[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = readFileSync(join(dir, file), 'utf8');
        const envelope = JSON.parse(content) as ArtifactEnvelope;
        envelopes.push(envelope);
      } catch {
        // Skip unparseable files
        continue;
      }
    }

    envelopes.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    return envelopes;
  } catch {
    return [];
  }
}
