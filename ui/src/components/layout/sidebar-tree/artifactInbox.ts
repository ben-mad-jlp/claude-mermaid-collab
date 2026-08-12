export type InboxEnvelopeState = 'pending' | 'adopted' | 'dismissed';

export type ArtifactType = 'document' | 'diagram' | 'design' | 'spreadsheet' | 'snippet' | 'image' | 'embed';

export interface InboxEnvelope {
  schemaVersion: number;
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
    type: ArtifactType;
    name: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  historyNote?: {
    versions: number;
    firstAt: string;
    lastAt: string;
  };
  state: InboxEnvelopeState;
  adoptedTo?: {
    project: string;
    session: string;
    artifactId: string;
  };
}

export const INBOX_LIST_PATH = '/api/artifact-inbox';

export function inboxAdoptPath(id: string): string {
  return `${INBOX_LIST_PATH}/${id}/adopt`;
}

export function inboxDismissPath(id: string): string {
  return `${INBOX_LIST_PATH}/${id}/dismiss`;
}
