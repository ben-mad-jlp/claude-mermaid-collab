import { recordNode, queryLedger, _closeLedgerDb } from './src/services/worker-ledger.ts';
process.env.MERMAID_SUPERVISOR_DIR = '/tmp/ledger-smoke-' + Date.now();
const id = recordNode({ project: 'p', todoId: 't', session: 's', model: 'sonnet', authMode: 'subscription', exitCode: 0, durationMs: 4545, rateLimited: false, nodesSpent: 1, leafId: 'P1', epicId: 'E' });
const rows = queryLedger({ project: 'p' });
console.log(JSON.stringify({ id: id != null, row: rows[0] && { phase: rows[0].phase, provider: rows[0].provider, source: rows[0].source, authMode: rows[0].authMode, exitCode: rows[0].exitCode, durationMs: rows[0].durationMs, rateLimited: rows[0].rateLimited, nodeKind: rows[0].nodeKind, leafId: rows[0].leafId } }));
_closeLedgerDb();
