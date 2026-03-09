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
  name: string;
  title: string;
  confidence: string;
}

export interface TopicDetail {
  name: string;
  title: string;
  content: {
    conceptual: string;
    technical: string;
    files: string;
    related: string;
    diagrams: string;
  };
}

export interface Category {
  name: string;
  topicCount: number;
  topics: string[];
}

export interface GraphNode {
  id: string;
  name: string;
  category: string;
  explored?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface SearchHit {
  topicName: string;
  fileType: string;
  snippet: string;
}

export interface DiagramBlock {
  title: string;
  content: string;
  filePath: string;
}

export interface User {
  id: number;
  name: string;
  createdAt: string;
}

export interface ProgressEntry {
  topicName: string;
  status: 'explored' | 'skipped';
  completedAt: string;
}

export interface Note {
  id: number;
  userId: number;
  topicName: string;
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

  getCategories: (project: string): Promise<Category[]> =>
    fetch(buildUrl('/categories', project)).then(r => handleResponse(r)),

  getGraph: (project: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> =>
    fetch(buildUrl('/graph', project)).then(r => handleResponse(r)),

  // Topics
  getTopics: (project: string): Promise<TopicSummary[]> =>
    fetch(buildUrl('/topics', project)).then(r => handleResponse(r)),

  getTopic: (project: string, name: string): Promise<TopicDetail> =>
    fetch(buildUrl(`/topics/${enc(name)}`, project)).then(r => handleResponse(r)),

  getDiagrams: (project: string, name: string): Promise<DiagramBlock[]> =>
    fetch(buildUrl(`/topics/${enc(name)}/diagram`, project)).then(r => handleResponse(r)),

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

  markProgress: (project: string, userId: number, topic: string, status: 'explored' | 'skipped'): Promise<void> =>
    fetch(buildUrl(`/progress/${userId}/${enc(topic)}`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  deleteProgress: (project: string, userId: number, topic: string): Promise<void> =>
    fetch(buildUrl(`/progress/${userId}/${enc(topic)}`, project), {
      method: 'DELETE',
    }).then(r => { if (!r.ok) throw new Error('Failed'); }),

  // Notes
  getNotes: (project: string, userId: number, topic: string): Promise<Note[]> =>
    fetch(buildUrl(`/notes/${userId}/${enc(topic)}`, project)).then(r => handleResponse(r)),

  addNote: (project: string, userId: number, topic: string, content: string): Promise<Note> =>
    fetch(buildUrl(`/notes/${userId}/${enc(topic)}`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
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
