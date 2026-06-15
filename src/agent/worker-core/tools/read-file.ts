/**
 * formatRead — paginated, line-numbered read formatting for worker-core tools.
 *
 * Pattern informed by opencode v0.3.0 `tool/read.ts`: 1-indexed offset/limit,
 * "<lineNo>: <content>" rendering, a byte cap, and a next-offset hint so a caller
 * can page a large file. Written fresh (pure; no fs — the caller supplies content).
 */

export interface ReadResult {
  /** Line-numbered slice ("<n>: <line>"), possibly truncated. */
  text: string;
  /** 1-indexed line to resume from on the next page, if more remain. */
  nextOffset?: number;
  /** True when more content remains beyond this slice (by limit or byte cap). */
  truncated: boolean;
  /** Total line count of the source. */
  totalLines: number;
}

export const READ_MAX_BYTES = 50 * 1024;
export const READ_DEFAULT_LIMIT = 2_000;

/** Render a 1-indexed, line-numbered window of `content`. `offset` is the 1-indexed
 *  first line; `limit` the max lines; output is additionally capped at READ_MAX_BYTES. */
export function formatRead(content: string, opts: { offset?: number; limit?: number } = {}): ReadResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const offset = Math.max(1, Math.floor(opts.offset ?? 1));
  const limit = Math.max(1, Math.floor(opts.limit ?? READ_DEFAULT_LIMIT));
  const start = offset - 1; // 0-indexed
  const window = lines.slice(start, start + limit);

  const out: string[] = [];
  let bytes = 0;
  let consumed = 0;
  for (let i = 0; i < window.length; i++) {
    const rendered = `${offset + i}: ${window[i]}`;
    bytes += Buffer.byteLength(rendered, 'utf8') + 1;
    if (bytes > READ_MAX_BYTES && out.length > 0) break; // byte cap (always emit ≥1 line)
    out.push(rendered);
    consumed++;
  }

  const endLine0 = start + consumed; // 0-indexed count rendered from file start
  const moreRemain = endLine0 < totalLines;
  return {
    text: out.join('\n'),
    nextOffset: moreRemain ? endLine0 + 1 : undefined,
    truncated: moreRemain,
    totalLines,
  };
}
