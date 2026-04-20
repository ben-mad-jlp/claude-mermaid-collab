/**
 * Command Receipts Store
 *
 * SQLite-backed idempotency receipt store for agent commands.
 * Each command has a deterministic hash and an outcome lifecycle:
 * pending -> accepted | rejected. Entries have a TTL; expired entries
 * are treated as absent.
 *
 * Stored at {project}/.collab/agent-receipts.db by default.
 */

import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export type ReceiptOutcome = 'pending' | 'accepted' | 'rejected';

export interface Receipt {
  commandId: string;
  payloadHash: string;
  outcome: ReceiptOutcome;
  resultSeq?: number;
  errorMessage?: string;
  expiresAt: number;
}

export interface CommandLike {
  commandId: string;
  [key: string]: unknown;
}

const DDL = `CREATE TABLE IF NOT EXISTS command_receipts (
  command_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_seq INTEGER,
  error_message TEXT,
  expires_at INTEGER NOT NULL
)`;

/**
 * Deterministically JSON-stringify a value by sorting object keys.
 * Arrays preserve order. Primitives and null pass through JSON.stringify.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + stableStringify(v));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Deterministic hash of a command object.
 * Keys are sorted recursively, then sha256'd.
 */
export function hashCommand(cmd: unknown): string {
  const canonical = stableStringify(cmd);
  return createHash('sha256').update(canonical).digest('hex');
}

export class CommandReceiptsStore {
  private db: Database;

  constructor(dbPathOrProject?: string, opts?: { isProjectRoot?: boolean }) {
    let dbPath: string;
    if (!dbPathOrProject) {
      dbPath = join(process.cwd(), '.collab', 'agent-receipts.db');
    } else if (opts?.isProjectRoot) {
      dbPath = join(dbPathOrProject, '.collab', 'agent-receipts.db');
    } else if (dbPathOrProject === ':memory:' || !isAbsolute(dbPathOrProject)) {
      // Treat as-is (allow :memory: or cwd-relative for tests)
      dbPath = dbPathOrProject;
    } else {
      dbPath = dbPathOrProject;
    }
    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch {
        // ignore
      }
    }
    this.db = new Database(dbPath);
    this.db.exec(DDL);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Insert a pending receipt for a new command. If a receipt with the same
   * commandId already exists, this throws (caller should check via `get`
   * first for idempotent handling).
   */
  insertPending(cmd: CommandLike, payloadHash: string, expiresAt: number): void {
    // INSERT OR REPLACE so expired entries (treated as absent by get()) can be
    // re-inserted without a uniqueness violation.
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO command_receipts (command_id, payload_hash, outcome, result_seq, error_message, expires_at)
       VALUES (?, ?, 'pending', NULL, NULL, ?)`,
    );
    stmt.run(cmd.commandId, payloadHash, expiresAt);
  }

  markAccepted(commandId: string, resultSeq: number): void {
    const stmt = this.db.prepare(
      `UPDATE command_receipts SET outcome = 'accepted', result_seq = ?, error_message = NULL
       WHERE command_id = ?`,
    );
    stmt.run(resultSeq, commandId);
  }

  markRejected(commandId: string, errorMessage: string): void {
    const stmt = this.db.prepare(
      `UPDATE command_receipts SET outcome = 'rejected', error_message = ?, result_seq = NULL
       WHERE command_id = ?`,
    );
    stmt.run(errorMessage, commandId);
  }

  get(commandId: string, now: number = Date.now()): Receipt | undefined {
    const row = this.db
      .prepare(
        `SELECT command_id, payload_hash, outcome, result_seq, error_message, expires_at
         FROM command_receipts WHERE command_id = ?`,
      )
      .get(commandId) as
      | {
          command_id: string;
          payload_hash: string;
          outcome: ReceiptOutcome;
          result_seq: number | null;
          error_message: string | null;
          expires_at: number;
        }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at < now) return undefined;
    const receipt: Receipt = {
      commandId: row.command_id,
      payloadHash: row.payload_hash,
      outcome: row.outcome,
      expiresAt: row.expires_at,
    };
    if (row.result_seq !== null) receipt.resultSeq = row.result_seq;
    if (row.error_message !== null) receipt.errorMessage = row.error_message;
    return receipt;
  }
}
