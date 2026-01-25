/**
 * Kodex API Client
 */

const API_BASE = '';

export interface TopicMetadata {
  name: string;
  title: string;
  confidence: 'low' | 'medium' | 'high';
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
  hasDraft: boolean;
}

export interface TopicContent {
  conceptual: string;
  technical: string;
  files: string;
  related: string;
}

export interface Topic extends TopicMetadata {
  content: TopicContent;
}

export interface Draft {
  topicName: string;
  content: TopicContent;
  createdAt: string;
  createdBy: string;
  reason: string;
}

export interface Flag {
  id: number;
  topicName: string;
  type: 'outdated' | 'incorrect' | 'incomplete' | 'missing';
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
}

export interface DashboardStats {
  totalTopics: number;
  verifiedTopics: number;
  pendingDrafts: number;
  openFlags: number;
  recentAccess: Array<{
    id: number;
    topicName: string;
    accessedAt: string;
    source: string;
  }>;
  topMissing: Array<{
    id: number;
    topicName: string;
    count: number;
  }>;
}

function buildUrl(path: string, project: string): string {
  const url = new URL(`${API_BASE}/api/kodex${path}`, window.location.origin);
  url.searchParams.set('project', project);
  return url.toString();
}

export const kodexApi = {
  // Dashboard
  async getDashboard(project: string): Promise<DashboardStats> {
    const response = await fetch(buildUrl('/dashboard', project));
    if (!response.ok) throw new Error('Failed to fetch dashboard');
    return response.json();
  },

  // Topics
  async listTopics(project: string): Promise<TopicMetadata[]> {
    const response = await fetch(buildUrl('/topics', project));
    if (!response.ok) throw new Error('Failed to list topics');
    return response.json();
  },

  async getTopic(project: string, name: string): Promise<Topic> {
    const response = await fetch(buildUrl(`/topics/${name}`, project));
    if (!response.ok) throw new Error('Topic not found');
    return response.json();
  },

  async createTopic(project: string, data: { name: string; title: string; content: TopicContent }): Promise<Draft> {
    const response = await fetch(buildUrl('/topics', project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create topic');
    return response.json();
  },

  async updateTopic(project: string, name: string, content: Partial<TopicContent>, reason: string): Promise<Draft> {
    const response = await fetch(buildUrl(`/topics/${name}`, project), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, reason }),
    });
    if (!response.ok) throw new Error('Failed to update topic');
    return response.json();
  },

  async deleteTopic(project: string, name: string): Promise<void> {
    const response = await fetch(buildUrl(`/topics/${name}`, project), {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete topic');
  },

  async verifyTopic(project: string, name: string, verifiedBy: string): Promise<TopicMetadata> {
    const response = await fetch(buildUrl(`/topics/${name}/verify`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verifiedBy }),
    });
    if (!response.ok) throw new Error('Failed to verify topic');
    return response.json();
  },

  // Flags
  async listFlags(project: string, status?: string): Promise<Flag[]> {
    let url = buildUrl('/flags', project);
    if (status) {
      url += `&status=${status}`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to list flags');
    return response.json();
  },

  async createFlag(project: string, topicName: string, type: Flag['type'], description: string): Promise<Flag> {
    const response = await fetch(buildUrl(`/topics/${topicName}/flag`, project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, description }),
    });
    if (!response.ok) throw new Error('Failed to create flag');
    return response.json();
  },

  async updateFlagStatus(project: string, id: number, status: Flag['status']): Promise<void> {
    const response = await fetch(buildUrl(`/flags/${id}`, project), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error('Failed to update flag');
  },

  // Drafts
  async listDrafts(project: string): Promise<Draft[]> {
    const response = await fetch(buildUrl('/drafts', project));
    if (!response.ok) throw new Error('Failed to list drafts');
    return response.json();
  },

  async approveDraft(project: string, name: string): Promise<Topic> {
    const response = await fetch(buildUrl(`/drafts/${name}/approve`, project), {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to approve draft');
    return response.json();
  },

  async rejectDraft(project: string, name: string): Promise<void> {
    const response = await fetch(buildUrl(`/drafts/${name}/reject`, project), {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to reject draft');
  },

  // Missing topics
  async listMissing(project: string): Promise<Array<{ topicName: string; count: number }>> {
    const response = await fetch(buildUrl('/missing', project));
    if (!response.ok) throw new Error('Failed to list missing topics');
    return response.json();
  },
};
