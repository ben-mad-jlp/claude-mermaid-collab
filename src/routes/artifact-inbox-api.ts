import { Buffer } from 'buffer';
import {
  MAX_ENVELOPE_BYTES,
  ARTIFACT_TYPES,
  writeEnvelope,
  listEnvelopes,
  ArtifactKind,
} from '../services/artifact-inbox-store.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleArtifactInboxAPI(
  req: Request,
  url: URL
): Promise<Response | null> {
  if (url.pathname === '/api/artifact-inbox' && req.method === 'POST') {
    const body = await req.text();
    const byteLength = Buffer.byteLength(body, 'utf8');

    if (byteLength > MAX_ENVELOPE_BYTES) {
      return jsonError(
        `envelope exceeds MAX_ENVELOPE_BYTES`,
        413
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return jsonError('invalid JSON', 400);
    }

    if (!data || typeof data !== 'object') {
      return jsonError('body must be a JSON object', 400);
    }

    const obj = data as Record<string, unknown>;

    if (obj.schemaVersion !== 1) {
      return jsonError('schemaVersion must be 1', 400);
    }

    if (!obj.from || typeof obj.from !== 'object') {
      return jsonError('from must be an object', 400);
    }

    if (!obj.artifact || typeof obj.artifact !== 'object') {
      return jsonError('artifact must be an object', 400);
    }

    const artifact = obj.artifact as Record<string, unknown>;

    if (
      typeof artifact.name !== 'string' ||
      artifact.name.length === 0
    ) {
      return jsonError('artifact.name must be a non-empty string', 400);
    }

    if (typeof artifact.content !== 'string') {
      return jsonError('artifact.content must be a string', 400);
    }

    if (!ARTIFACT_TYPES.includes(artifact.type as ArtifactKind)) {
      return jsonError(
        `artifact.type must be one of: ${ARTIFACT_TYPES.join(', ')}`,
        400
      );
    }

    const envelope = writeEnvelope({
      from: obj.from as Record<string, unknown>,
      artifact: {
        type: artifact.type as ArtifactKind,
        name: artifact.name,
        content: artifact.content,
        metadata: artifact.metadata as Record<string, unknown> | undefined,
      },
      historyNote: typeof obj.historyNote === 'string' ? obj.historyNote : undefined,
    });

    try {
      getWebSocketHandler()?.broadcast({ type: 'artifact_inbox_updated' });
    } catch {
      // Broadcast failure never fails an accepted delivery
    }

    return Response.json(
      { envelopeId: envelope.envelopeId, receivedAt: envelope.receivedAt },
      { status: 200 }
    );
  }

  if (url.pathname === '/api/artifact-inbox' && req.method === 'GET') {
    const stateFilter = url.searchParams.get('state') || undefined;
    const envelopes = listEnvelopes();

    const projected = envelopes
      .filter((e) => !stateFilter || e.state === stateFilter)
      .map((e) => ({
        envelopeId: e.envelopeId,
        type: e.artifact.type,
        name: e.artifact.name,
        from: e.from,
        receivedAt: e.receivedAt,
        state: e.state,
      }));

    return Response.json(
      { envelopes: projected },
      { status: 200 }
    );
  }

  if (url.pathname === '/api/artifact-inbox') {
    return jsonError('method not allowed', 405);
  }

  return null;
}
