import { Buffer } from 'buffer';
import {
  MAX_ENVELOPE_BYTES,
  ARTIFACT_TYPES,
  writeEnvelope,
  listEnvelopes,
  readEnvelope,
  ArtifactKind,
  type ArtifactEnvelope,
} from '../services/artifact-inbox-store.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import {
  listAllSubscriptions,
  subscriptionMatches,
  enqueueNotification,
  type SubscribableEvent,
} from '../services/session-subscriptions.js';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function nudgeSubscribersForEnvelope(envelope: ArtifactEnvelope): void {
  try {
    // An envelope is a mailbox-level event with no work-graph identity: pathless
    // (no todoId/epicId/missionId), so by session-subscriptions.ts:60-69 only
    // 'project'-scope subs match. Reuse the matcher — never re-implement the rule.
    for (const sub of listAllSubscriptions()) {
      const evt: SubscribableEvent = { project: sub.project };
      if (!subscriptionMatches(sub, evt)) continue;
      enqueueNotification({
        project: sub.project,
        session: sub.session,
        scope: sub.scope,
        targetId: sub.targetId,
        event: 'artifact_inbox_received',
        summary: `artifact inbox: ${envelope.artifact.type} "${envelope.artifact.name}"`,
        payload: {
          envelopeId: envelope.envelopeId,
          type: envelope.artifact.type,
          name: envelope.artifact.name,
          receivedAt: envelope.receivedAt,
        },
      });
    }
  } catch {
    // A delivery that persisted MUST still 200 — an unwritable subscriptions.db
    // never fails an accepted envelope.
  }
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

    nudgeSubscribersForEnvelope(envelope);

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

  // Per-envelope routes. The LIST above is deliberately a metadata projection
  // (no content); the viewer fetches the FULL envelope here, and the UI's
  // adopt/dismiss buttons finally have HTTP counterparts to the MCP verbs
  // (they shipped pointing at these paths with no handler behind them).
  const m = url.pathname.match(/^\/api\/artifact-inbox\/([^/]+)(?:\/(adopt|dismiss))?$/);
  if (m) {
    const [, envelopeId, action] = m;

    if (!action && req.method === 'GET') {
      const envelope = readEnvelope(envelopeId);
      if (!envelope) return jsonError('envelope not found', 404);
      return Response.json(envelope, { status: 200 });
    }

    if (action === 'adopt' && req.method === 'POST') {
      let body: { project?: string; session?: string; name?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return jsonError('invalid JSON', 400);
      }
      if (!body.project || !body.session) return jsonError('project and session are required', 400);
      try {
        // Lazy import: the MCP tool chain pulls in session-tools/config; loading it at
        // module scope broadens dispatch's import graph and breaks narrow test mocks.
        const { adoptArtifact } = await import('../mcp/tools/artifact-inbox.js');
        const result = JSON.parse(await adoptArtifact(envelopeId, body.project, body.session, body.name));
        try { getWebSocketHandler()?.broadcast({ type: 'artifact_inbox_updated' }); } catch { /* never fails the adopt */ }
        return Response.json(result, { status: 200 });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'adopt failed', 400);
      }
    }

    if (action === 'dismiss' && req.method === 'POST') {
      try {
        const { dismissArtifact } = await import('../mcp/tools/artifact-inbox.js');
        const result = JSON.parse(await dismissArtifact(envelopeId));
        try { getWebSocketHandler()?.broadcast({ type: 'artifact_inbox_updated' }); } catch { /* never fails the dismiss */ }
        return Response.json(result, { status: 200 });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'dismiss failed', 400);
      }
    }

    return jsonError('method not allowed', 405);
  }

  return null;
}
