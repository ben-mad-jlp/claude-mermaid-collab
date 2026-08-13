/**
 * Artifact Inbox MCP tools — adopt_artifact and dismiss_artifact
 *
 * Wires envelopes from the artifact inbox into projects and sessions.
 */

import { existsSync } from 'fs';
import { buildUrl, apiFetch } from './http-util.js';
import { resolveProjectArg } from '../../services/project-registry.js';
import { sessionRegistry } from '../../services/session-registry.js';
import {
  readEnvelope,
  markAdopted,
  markDismissed,
  EnvelopeNotFoundError,
  EnvelopeNotPendingError,
  type ArtifactKind,
} from '../../services/artifact-inbox-store.js';
import {
  createDocument,
} from './documents.js';
import {
  createDiagram,
} from '../diagram-tools.js';
import {
  createSpreadsheet,
} from '../spreadsheet-tools.js';
import {
  handleCreateSnippet,
} from './snippet.js';
import {
  handleCreateDesign,
} from './design.js';
import {
  handleCreateImage,
} from './image.js';

// Error classes matching the store's error shape

export class ProjectNotRegisteredError extends Error {
  name = 'PROJECT_NOT_REGISTERED';
  constructor(message: string) {
    super(message);
  }
}

export class SessionDirNotFoundError extends Error {
  name = 'SESSION_DIR_NOT_FOUND';
  constructor(message: string) {
    super(message);
  }
}

// Main functions

export async function adoptArtifact(
  envelopeId: string,
  projectArg: string,
  session: string,
  nameOverride?: string,
): Promise<string> {
  // Step 1: Resolve project, with try/catch to re-throw as ProjectNotRegisteredError
  let project: string;
  try {
    project = resolveProjectArg(projectArg);
  } catch (err) {
    throw new ProjectNotRegisteredError((err as Error).message);
  }

  // Step 2: Check session directory exists
  try {
    const sessionPath = sessionRegistry.resolvePath(project, session, '.');
    if (!existsSync(sessionPath)) {
      throw new SessionDirNotFoundError(`session directory for ${session} not found at ${sessionPath}`);
    }
  } catch (err) {
    if (err instanceof SessionDirNotFoundError) {
      throw err;
    }
    // If resolvePath itself throws (malformed project/session), let it propagate
    throw err;
  }

  // Step 3: Read envelope and check state
  const envelope = readEnvelope(envelopeId);
  if (!envelope) {
    throw new EnvelopeNotFoundError(envelopeId);
  }
  if (envelope.state !== 'pending') {
    throw new EnvelopeNotPendingError(envelopeId, envelope.state);
  }

  // Step 4: Create via appropriate type-specific helper
  const name = nameOverride ?? envelope.artifact.name;
  const { type, content } = envelope.artifact;
  let id: string;

  switch (type) {
    case 'document': {
      const result = await createDocument(project, session, name, content);
      id = JSON.parse(result).id;
      break;
    }
    case 'diagram': {
      const result = await createDiagram(project, session, name, content);
      id = JSON.parse(result).id;
      break;
    }
    case 'spreadsheet': {
      const result = await createSpreadsheet(project, session, name, content);
      id = JSON.parse(result).id;
      break;
    }
    case 'snippet': {
      const result = await handleCreateSnippet(project, session, name, content);
      id = result.id;
      break;
    }
    case 'design': {
      const result = await handleCreateDesign(project, session, name, JSON.parse(content));
      id = result.id;
      break;
    }
    case 'image': {
      const result = await handleCreateImage(project, session, name, content);
      id = result.id;
      break;
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown artifact type: ${_exhaustive}`);
    }
  }

  // Step 5: Metadata replay if present
  if (envelope.artifact.metadata && Object.keys(envelope.artifact.metadata).length > 0) {
    const metadataBody: Record<string, boolean> = {
      locked: true, // blueprint implies locked
    };
    if ('locked' in envelope.artifact.metadata) {
      metadataBody.locked = envelope.artifact.metadata.locked as boolean;
    }
    if ('pinned' in envelope.artifact.metadata) {
      metadataBody.pinned = envelope.artifact.metadata.pinned as boolean;
    }
    if ('deprecated' in envelope.artifact.metadata) {
      metadataBody.deprecated = envelope.artifact.metadata.deprecated as boolean;
    }

    const metaResponse = await apiFetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadataBody),
    });
    if (!metaResponse.ok) {
      throw new Error(`Failed to set metadata: ${metaResponse.statusText}`);
    }
  }

  // Step 6: Verified re-read via GET
  const pathSegment = getArtifactPathSegment(type);
  const verifyResponse = await apiFetch(buildUrl(`/api/${pathSegment}/${id}`, project, session));
  if (!verifyResponse.ok) {
    throw new Error(`Failed to verify created artifact: ${id}`);
  }

  // Step 7: Mark adopted and return
  const adopted = markAdopted(envelopeId, { project, session, artifactId: id });
  return JSON.stringify({ success: true, envelopeId, project, session, type, id, state: adopted.state }, null, 2);
}

export async function dismissArtifact(envelopeId: string): Promise<string> {
  const dismissed = markDismissed(envelopeId);
  return JSON.stringify({ success: true, envelopeId, state: dismissed.state }, null, 2);
}

// Helpers

function getArtifactPathSegment(type: ArtifactKind): string {
  switch (type) {
    case 'document': return 'document';
    case 'diagram': return 'diagram';
    case 'design': return 'design';
    case 'spreadsheet': return 'spreadsheet';
    case 'snippet': return 'snippet';
    case 'image': return 'image';
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown artifact type: ${_exhaustive}`);
    }
  }
}

// Tool definitions (wire-clean: only name, description, inputSchema)

export const ARTIFACT_INBOX_TOOL_DEFS = [
  {
    name: 'adopt_artifact',
    description: 'Adopt a pending artifact from the inbox into a project session.',
    inputSchema: {
      type: 'object',
      properties: {
        envelopeId: {
          type: 'string',
          description: 'The envelope ID from the artifact inbox.',
        },
        project: {
          type: 'string',
          description: 'Absolute path to the project root directory or registered project name.',
        },
        session: {
          type: 'string',
          description: 'Session name (e.g., "bright-calm-river").',
        },
        name: {
          type: 'string',
          description: 'Optional name override for the adopted artifact; defaults to envelope artifact name.',
        },
      },
      required: ['envelopeId', 'project', 'session'],
    },
  },
  {
    name: 'dismiss_artifact',
    description: 'Dismiss a pending artifact from the inbox without adopting it.',
    inputSchema: {
      type: 'object',
      properties: {
        envelopeId: {
          type: 'string',
          description: 'The envelope ID from the artifact inbox.',
        },
      },
      required: ['envelopeId'],
    },
  },
];

// Dispatcher (module-private HANDLERS, returns null for foreign names)

const HANDLERS: Record<string, (args: any) => Promise<string>> = {
  'adopt_artifact': async (args) => {
    const { envelopeId, project, session, name } = args;
    if (!envelopeId) throw new Error('envelopeId is required');
    if (!project) throw new Error('project is required');
    if (!session) throw new Error('session is required');
    return adoptArtifact(envelopeId, project, session, name);
  },
  'dismiss_artifact': async (args) => {
    const { envelopeId } = args;
    if (!envelopeId) throw new Error('envelopeId is required');
    return dismissArtifact(envelopeId);
  },
};

export async function handleArtifactInboxTool(name: string, args: any): Promise<string | null> {
  const handler = HANDLERS[name];
  if (!handler) return null;
  return handler(args);
}
