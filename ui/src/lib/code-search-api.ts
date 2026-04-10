/**
 * Code Search API Client — HTTP fetch for cross-artifact search
 *
 * Wraps POST /api/code/search which fans out to pseudo FTS + linked
 * snippet content grep and returns unified results.
 */

export interface CodeSearchResult {
  kind: 'pseudo' | 'code';
  filePath: string;
  methodName?: string;
  line?: number;
  snippet: string;
  snippetId?: string;
}

export interface CodeSearchResponse {
  results: CodeSearchResult[];
  truncated: boolean;
}

/**
 * Search across pseudo files (FTS) and linked code snippets (content grep).
 * Returns unified results with kind: 'pseudo' | 'code'.
 */
export async function fetchCodeSearch(
  project: string,
  session: string,
  query: string,
  limit = 50,
): Promise<CodeSearchResponse> {
  const params = new URLSearchParams({ project, session });
  const response = await fetch(`/api/code/search?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `Failed to search code: ${response.statusText}`);
  }
  return response.json();
}
