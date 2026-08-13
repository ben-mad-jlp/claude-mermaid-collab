// Artifact send tool — deliver local artifacts to remote inbox with verified receipt.

import { API_BASE_URL, sessionParamsDesc, asJson } from './tools/http-util.js';
import { serverOwner } from '../services/port-ownership.js';
import {
  ARTIFACT_TYPES,
  ArtifactKind,
} from '../services/artifact-inbox-store.js';
import {
  getDocument,
} from './document-tools.js';
import {
  getDiagram,
} from './diagram-tools.js';
import {
  getSpreadsheet,
} from './spreadsheet-tools.js';
import {
  handleGetSnippet,
} from './tools/snippet.js';
import {
  handleGetDesign,
} from './tools/design.js';
import {
  handleGetImage,
} from './tools/image.js';
import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface SendArtifactDeps {
  readArtifact(type: ArtifactKind, project: string, session: string, id: string): Promise<{ name: string; content: string; metadata?: Record<string, unknown> }>;
  fetchImpl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>;
}

// Default dependencies: read from local API endpoints and use native fetch
export const DEFAULT_SEND_DEPS: SendArtifactDeps = {
  async readArtifact(type: ArtifactKind, project: string, session: string, id: string) {
    if (type === 'document') {
      const docJson = await getDocument(project, session, id);
      const docData = JSON.parse(docJson);
      return {
        name: docData.name,
        content: docData.content,
      };
    }

    if (type === 'diagram') {
      const diagJson = await getDiagram(project, session, id);
      const diagData = JSON.parse(diagJson);
      return {
        name: diagData.name,
        content: diagData.content,
      };
    }

    if (type === 'spreadsheet') {
      const ssJson = await getSpreadsheet(project, session, id);
      const ssData = JSON.parse(ssJson);
      return {
        name: ssData.name,
        content: JSON.stringify(ssData.content),
      };
    }

    if (type === 'snippet') {
      const snippetResult = await handleGetSnippet(project, session, id);
      return {
        name: snippetResult.name,
        content: snippetResult.content,
      };
    }

    if (type === 'design') {
      const designResult = await handleGetDesign(project, session, id);
      const designContent = typeof designResult.content === 'string'
        ? designResult.content
        : JSON.stringify(designResult.content);
      return {
        name: designResult.name,
        content: designContent,
      };
    }

    if (type === 'image') {
      const imageResult = await handleGetImage(project, session, id);
      const imageBuffer = readFileSync(imageResult.path);
      const b64 = imageBuffer.toString('base64');
      const mimeType = imageResult.mimeType || 'application/octet-stream';
      return {
        name: imageResult.name,
        content: `data:${mimeType};base64,${b64}`,
      };
    }

    throw new Error(`Unsupported artifact type: ${type}`);
  },
  fetchImpl: fetch,
};

// ---------------------------------------------------------------------------
// Core send function with verified re-read receipt
// ---------------------------------------------------------------------------

export interface SendArtifactResult {
  envelopeId: string;
  receivedAt: string;
}

export async function sendArtifact(
  args: {
    project: string;
    session: string;
    type: ArtifactKind;
    id: string;
    to: { server: string };
    note?: string;
    token?: string;
  },
  deps: SendArtifactDeps = DEFAULT_SEND_DEPS,
): Promise<SendArtifactResult> {
  // Read the artifact from the local store
  const artifact = await deps.readArtifact(args.type, args.project, args.session, args.id);

  // Normalize the target server URL: strip trailing slash
  let targetBase = args.to.server;
  if (!targetBase.startsWith('http://') && !targetBase.startsWith('https://')) {
    throw new Error(`send_artifact: 'to.server' must be a full URL (http:// or https://), got: ${targetBase}`);
  }
  targetBase = targetBase.replace(/\/$/, '');

  // Build the envelope body
  const envelope = {
    schemaVersion: 1,
    from: {
      serverOwner: serverOwner(),
      baseUrl: API_BASE_URL,
      project: args.project,
      session: args.session,
      note: args.note,
    },
    artifact: {
      type: args.type,
      name: artifact.name,
      content: artifact.content,
      metadata: artifact.metadata,
    },
    historyNote: typeof args.note === 'string' ? args.note : undefined,
  };

  // POST the envelope to the target inbox
  const postUrl = `${targetBase}/api/artifact-inbox`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.token) {
    headers['Authorization'] = `Bearer ${args.token}`;
  }

  const postResponse = await deps.fetchImpl(postUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });

  if (!postResponse.ok) {
    const errorText = await postResponse.text();
    throw new Error(`send_artifact: POST to ${postUrl} failed with ${postResponse.status}: ${errorText}`);
  }

  const postData = (await asJson(postResponse)) as { envelopeId?: string; receivedAt?: string };
  const deliveredId = postData.envelopeId;

  if (!deliveredId) {
    throw new Error(`send_artifact: POST response missing envelopeId`);
  }

  // Re-read the target inbox to verify the envelope was received
  const getUrl = `${targetBase}/api/artifact-inbox`;
  const getResponse = await deps.fetchImpl(getUrl, {
    headers: args.token ? { 'Authorization': `Bearer ${args.token}` } : undefined,
  });

  if (!getResponse.ok) {
    throw new Error(`send_artifact: GET ${getUrl} failed with ${getResponse.status}`);
  }

  const getData = (await asJson(getResponse)) as { envelopes?: Array<{ envelopeId: string; receivedAt: string }> };
  const envelopes = getData.envelopes || [];
  const received = envelopes.find((e) => e.envelopeId === deliveredId);

  if (!received) {
    throw new Error(`send_artifact: envelope ${deliveredId} not found in target inbox after delivery`);
  }

  return {
    envelopeId: received.envelopeId,
    receivedAt: received.receivedAt,
  };
}

// ---------------------------------------------------------------------------
// ListTools declaration
// ---------------------------------------------------------------------------

export const ARTIFACT_SEND_TOOL_DEFS = [
  {
    name: 'send_artifact',
    description: 'Send a local artifact to a remote mermaid-collab inbox. Verifies receipt by re-reading the target inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionParamsDesc,
        type: {
          type: 'string',
          enum: ARTIFACT_TYPES,
          description: 'The artifact type: document, diagram, design, spreadsheet, snippet, or image',
        },
        id: {
          type: 'string',
          description: 'The artifact ID within the session',
        },
        to: {
          type: 'object',
          properties: {
            server: {
              type: 'string',
              description: 'The target server base URL (e.g., http://localhost:9002 or https://collab.example.com)',
            },
          },
          required: ['server'],
          description: 'Target inbox location',
        },
        note: {
          type: 'string',
          description: 'Optional history note (e.g., reason for sending)',
        },
        token: {
          type: 'string',
          description: 'Optional bearer token for authentication at the target server',
        },
      },
      required: ['project', 'session', 'type', 'id', 'to'],
    },
  },
];

// ---------------------------------------------------------------------------
// CallTool handler
// ---------------------------------------------------------------------------

export async function handleArtifactSendTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'send_artifact': {
      const { project, session, type, id, to, note, token } = args as {
        project?: string;
        session?: string;
        type?: string;
        id?: string;
        to?: { server: string };
        note?: string;
        token?: string;
      };
      if (!project || !session || !type || !id || !to || !to.server) {
        throw new Error('Missing required: project, session, type, id, to.server');
      }
      if (!ARTIFACT_TYPES.includes(type as ArtifactKind)) {
        throw new Error(`Invalid type: ${type}. Must be one of: ${ARTIFACT_TYPES.join(', ')}`);
      }
      const result = await sendArtifact(
        {
          project,
          session,
          type: type as ArtifactKind,
          id,
          to,
          note,
          token,
        },
      );
      return JSON.stringify(result, null, 2);
    }

    default:
      return null;
  }
}
