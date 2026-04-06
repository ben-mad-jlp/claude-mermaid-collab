/**
 * Onboarding API Client
 *
 * Typed fetch wrapper for /api/onboarding/* endpoints.
 */

// ============================================================================
// Types
// ============================================================================

export interface OnboardingConfig {
  title: string;
  topicCount: number;
  defaultMode: 'browse' | 'onboard';
}

export interface TopicSummary {
  filePath: string;
  title: string;
}

export interface TopicDetail {
  filePath: string;
  title: string;
  content: {
    overview: string;
    functions: string;
    dependencies: string;
  };
}

export interface Category {
  name: string;
  fileCount: number;
  files: string[];
}

export interface GraphNode {
  id: string;
  name: string;
  directory: string;
  explored?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface SearchHit {
  filePath: string;
  section: string;
  snippet: string;
}

export interface User {
  id: number;
  name: string;
  createdAt: string;
}

export interface ProgressEntry {
  filePath: string;
  status: 'explored' | 'skipped';
  completedAt: string;
}

export interface Note {
  id: number;
  userId: number;
  filePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  id: number;
  name: string;
  createdAt: string;
  exploredTopics: string[];
  exploredCount: number;
  lastActive: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

const enc = encodeURIComponent;

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function buildUrl(path: string, project: string): string {
  const url = new URL(`/api/onboarding${path}`, window.location.origin);
  url.searchParams.set('project', project);
  return url.toString();
}

// ============================================================================
// API Client
// ============================================================================

export const onboardingApi = {
  // Config + Categories + Graph
  getConfig: (project: string): Promise<OnboardingConfig> =>
    fetch(buildUrl('/config', project)).then(r => handleResponse(r)),

  getDirectories: (project: string): Promise<Category[]> =>
    fetch(buildUrl('/directories', project)).then(r => handleResponse(r)),

  getGraph: (project: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> =>
    fetch(buildUrl('/graph', project)).then(r => handleResponse(r)),

  // Files
  getFiles: (project: string): Promise<TopicSummary[]> =>
    fetch(buildUrl('/files', project)).then(r => handleResponse(r)),

  getFile: (project: string, filePath: string): Promise<TopicDetail> =>
    fetch(buildUrl(`/files/${encodeURIComponent(filePath)}`, project)).then(r => handleResponse(r)),

  // Search
  search: (project: string, q: string, scope?: string): Promise<SearchHit[]> => {
    let url = buildUrl('/search', project);
    url += `&q=${enc(q)}`;
    if (scope) url += `&scope=${enc(scope)}`;
    return fetch(url).then(r => handleResponse(r));
  },

  // Users
  createUser: (project: string, name: string): Promise<User> =>
    fetch(buildUrl('/users', project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => handleResponse(r)),

  listUsers: (project: string): Promise<User[]> =>
    fetch(buildUrl('/users', project)).then(r => handleResponse(r)),

  getUser: (project: string, id: number): Promise<User> =>
    fetch(buildUrl(`/users/${id}`, project)).then(r => handleResponse(r)),

  // Progress
  getProgress: (project: string, userId: number): Promise<ProgressEntry[]> =>
    fetch(buildUrl(`/progress/${userId}`, project)).then(r => handleResponse(r)),

  markProgress: (project: string, userId: number, filePath: string, status: 'explored' | 'skipped'): Promise<void> =>
    fetch(buildUrl(`/progress/${userId}/${enc(filePath)}`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, status }),
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  deleteProgress: (project: string, userId: number, filePath: string): Promise<void> =>
    fetch(buildUrl(`/progress/${userId}/${enc(filePath)}`, project), {
      method: 'DELETE',
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  // Notes
  getNotes: (project: string, userId: number, filePath: string): Promise<Note[]> =>
    fetch(buildUrl(`/notes/${userId}/${enc(filePath)}`, project)).then(r => handleResponse(r)),

  addNote: (project: string, userId: number, filePath: string, content: string): Promise<Note> =>
    fetch(buildUrl(`/notes/${userId}/${enc(filePath)}`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, content }),
    }).then(r => handleResponse(r)),

  editNote: (project: string, noteId: number, content: string): Promise<void> =>
    fetch(buildUrl(`/notes/${noteId}`, project), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  deleteNote: (project: string, noteId: number): Promise<void> =>
    fetch(buildUrl(`/notes/${noteId}`, project), {
      method: 'DELETE',
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  // Team
  getTeam: (project: string): Promise<TeamMember[]> =>
    fetch(buildUrl('/team', project)).then(r => handleResponse(r)),
};
