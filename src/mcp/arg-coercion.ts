/** Shared coercion for MCP object-array arguments that may arrive as JSON strings.
 *
 *  Some MCP clients marshal an array-of-objects argument as a JSON string instead of a
 *  real array. This function normalizes both forms. Fail CLOSED: throws on any bad input
 *  rather than falling back or silently coercing to an empty array. */

export function coerceArrayArg(raw: unknown, paramName: string): unknown[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); }
    catch { throw new Error(`${paramName} must be a JSON array; received an unparseable string`); }
  }
  if (!Array.isArray(v)) throw new Error(`${paramName} must be an array`);
  return v;
}
