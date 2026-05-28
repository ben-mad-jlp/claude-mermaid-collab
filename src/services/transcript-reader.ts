/**
 * transcript-reader — read-only helpers for locating and extracting the last
 * completed assistant turn from a Claude Code session transcript.
 *
 * Resolves a session binding file in /tmp to its owning project/session, maps
 * the project cwd to the on-disk transcript path under ~/.claude/projects, and
 * tail-reads the JSONL transcript to find the most recent end_turn assistant
 * message. No writes are performed anywhere.
 */

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface LastTurn {
  text: string;
  stopReason: string | null;
  found: boolean;
}

export async function readBinding(
  claudeSessionId: string,
): Promise<{ project: string; session: string; claudePid: string } | null> {
  try {
    const p = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
    const raw = await fsp.readFile(p, 'utf8');
    const o = JSON.parse(raw);
    return { project: o.project, session: o.session, claudePid: o.claudePid };
  } catch {
    return null;
  }
}

export function transcriptPath(project: string, claudeSessionId: string): string {
  const encoded = project.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded, `${claudeSessionId}.jsonl`);
}

export async function lastAssistantTurn(claudeSessionId: string): Promise<LastTurn> {
  const binding = await readBinding(claudeSessionId);
  if (!binding) return { text: '', stopReason: null, found: false };

  const p = transcriptPath(binding.project, claudeSessionId);

  let text: string;
  try {
    const fh = await fsp.open(p, 'r');
    try {
      const { size } = await fh.stat();
      const readLen = Math.min(size, 256 * 1024);
      const start = size - readLen;
      const buf = Buffer.alloc(readLen);
      await fh.read(buf, 0, readLen, start);
      text = buf.toString('utf8');
      if (start > 0) {
        const nl = text.indexOf('\n');
        if (nl >= 0) text = text.slice(nl + 1);
      }
    } finally {
      await fh.close();
    }
  } catch {
    return { text: '', stopReason: null, found: false };
  }

  const lines = text.split('\n');
  let match: any = null;
  for (const line of lines) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      o.type === 'assistant' &&
      o.message &&
      o.message.stop_reason === 'end_turn' &&
      o.isSidechain !== true
    ) {
      match = o;
    }
  }

  if (match) {
    const textOut = (match.message.content || [])
      .filter((c: any) => c && c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    return { text: textOut, stopReason: match.message.stop_reason, found: true };
  }

  return { text: '', stopReason: null, found: false };
}
