/**
 * Pseudo API Client - HTTP fetch methods for pseudocode files
 */

export type Reference = {
  file: string;
  callerMethod: string;
};

export interface SearchResult {
  filePath: string;
  methodName: string;
  snippet: string;
  rank: number;
}

const API_BASE = ''; // Use relative URLs (same host)

export interface PseudoFileSummary {
  filePath: string;
  title: string;
  methodCount: number;
  exportCount: number;
  lastUpdated: string;
}

export interface PseudoMethod {
  name: string;
  params: string;
  returnType: string;
  isExported: boolean;
  date: string | null;
  steps: Array<{ content: string; depth: number }>;
  calls: Array<{ name: string; fileStem: string }>;
}

export interface PseudoFileWithMethods {
  filePath: string;
  title: string;
  purpose: string;
  moduleContext: string;
  syncedAt: string | null;
  methods: PseudoMethod[];
}

/**
 * Fetch list of .pseudo files in a project
 * GET /api/pseudo/files?project=...
 * Returns: string[] - Array of .pseudo file names
 */
export async function fetchPseudoFiles(project: string): Promise<PseudoFileSummary[]> {
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
export async function fetchPseudoFile(project: string, file: string): Promise<PseudoFileWithMethods> {
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
    return data;
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
    return data.matches || [];
  } catch (error) {
    throw error;
  }
}
