/**
 * Pseudo API Client - HTTP fetch methods for pseudocode files
 */

export type Reference = {
  file: string;
  callerFunction: string;
};

export type SearchMatch = {
  functionName: string | null;
  line: string;
  lineNumber: number;
  isFunctionLine: boolean;
};

export type SearchResult = {
  file: string;
  matches: SearchMatch[];
};

const API_BASE = ''; // Use relative URLs (same host)

/**
 * Fetch list of .pseudo files in a project
 * GET /api/pseudo/files?project=...
 * Returns: string[] - Array of .pseudo file names
 */
export async function fetchPseudoFiles(project: string): Promise<string[]> {
  try {
    const encodedProject = encodeURIComponent(project);
    const response = await fetch(`${API_BASE}/api/pseudo/files?project=${encodedProject}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch pseudo files: ${response.statusText}`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    throw error;
  }
}

/**
 * Fetch contents of a .pseudo file
 * GET /api/pseudo/file?project=...&file=...
 * Returns: string - File contents
 */
export async function fetchPseudoFile(project: string, file: string): Promise<string> {
  try {
    const encodedProject = encodeURIComponent(project);
    const encodedFile = encodeURIComponent(file);
    const response = await fetch(
      `${API_BASE}/api/pseudo/file?project=${encodedProject}&file=${encodedFile}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch pseudo file: ${response.statusText}`);
    }

    const data = await response.json();
    return data.content || '';
  } catch (error) {
    throw error;
  }
}

/**
 * Find all functions that reference (CALL) a given function
 * GET /api/pseudo/references?project=...&functionName=...&fileStem=...
 */
export async function fetchPseudoReferences(
  project: string,
  functionName: string,
  fileStem: string
): Promise<Reference[]> {
  const params = new URLSearchParams({ project, functionName, fileStem });
  const response = await fetch(`${API_BASE}/api/pseudo/references?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch references: ${response.statusText}`);
  }
  const data = await response.json();
  return data.references || [];
}

/**
 * Search across .pseudo files in a project
 * GET /api/pseudo/search?project=...&q=...
 * Returns: SearchResult[] - Array of files with matching lines
 */
export async function searchPseudo(project: string, q: string): Promise<SearchResult[]> {
  try {
    const encodedProject = encodeURIComponent(project);
    const encodedQuery = encodeURIComponent(q);
    const response = await fetch(
      `${API_BASE}/api/pseudo/search?project=${encodedProject}&q=${encodedQuery}`
    );

    if (!response.ok) {
      throw new Error(`Failed to search pseudo files: ${response.statusText}`);
    }

    const data = await response.json();
    const matches: Record<string, SearchMatch[]> = data.matches || {};
    return Object.entries(matches).map(([file, fileMatches]) => ({ file, matches: fileMatches }));
  } catch (error) {
    throw error;
  }
}
