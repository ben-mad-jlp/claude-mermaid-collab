class APIClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
    this.ws = null;
    this.wsListeners = new Set();
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connectionStatus = 'disconnected';
    this.statusListeners = new Set();
    this.pendingMessages = [];

    // Session params - must be set before API calls work
    this.project = null;
    this.session = null;
  }

  /**
   * Set the current project and session for all API calls.
   * @param {string} project - Absolute path to project directory
   * @param {string} session - Session name
   */
  setSession(project, session) {
    this.project = project;
    this.session = session;
  }

  /**
   * Clear the current session.
   */
  clearSession() {
    this.project = null;
    this.session = null;
  }

  /**
   * Get query string for session params.
   * @returns {string} Query string like "?project=...&session=..."
   */
  getSessionQuery() {
    if (!this.project || !this.session) {
      return '';
    }
    return `?project=${encodeURIComponent(this.project)}&session=${encodeURIComponent(this.session)}`;
  }

  /**
   * Check if session is configured.
   * @returns {boolean}
   */
  hasSession() {
    return !!this.project && !!this.session;
  }

  // Session API methods (no session params required)
  async getSessions() {
    const response = await fetch(`${this.baseURL}/api/sessions`);
    return response.json();
  }

  async registerSession(project, session) {
    const response = await fetch(`${this.baseURL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session }),
    });
    return response.json();
  }

  async unregisterSession(project, session) {
    const response = await fetch(`${this.baseURL}/api/sessions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, session }),
    });
    return response.json();
  }

  // HTTP API methods (require session params)
  async getDiagrams() {
    const response = await fetch(`${this.baseURL}/api/diagrams${this.getSessionQuery()}`);
    return response.json();
  }

  async getDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}${this.getSessionQuery()}`);
    return response.json();
  }

  async createDiagram(name, content) {
    const response = await fetch(`${this.baseURL}/api/diagram${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    return response.json();
  }

  async updateDiagram(id, content) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  async deleteDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}${this.getSessionQuery()}`, {
      method: 'DELETE',
    });
    return response.json();
  }

  async validateDiagram(content) {
    // Validate doesn't need session params - it's syntax only
    const response = await fetch(`${this.baseURL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  getThumbnailURL(id) {
    return `${this.baseURL}/api/thumbnail/${id}${this.getSessionQuery()}`;
  }

  getRenderURL(id, theme = 'default') {
    const sessionQuery = this.getSessionQuery();
    const separator = sessionQuery ? '&' : '?';
    return `${this.baseURL}/api/render/${id}${sessionQuery}${separator}theme=${theme}`;
  }

  // Document API methods
  async getDocuments() {
    const response = await fetch(`${this.baseURL}/api/documents${this.getSessionQuery()}`);
    return response.json();
  }

  async getDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}${this.getSessionQuery()}`);
    return response.json();
  }

  async createDocument(name, content) {
    const response = await fetch(`${this.baseURL}/api/document${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    return response.json();
  }

  async updateDocument(id, content) {
    const response = await fetch(`${this.baseURL}/api/document/${id}${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  async deleteDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}${this.getSessionQuery()}`, {
      method: 'DELETE',
    });
    return response.json();
  }

  async getCleanDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}/clean${this.getSessionQuery()}`);
    return response.json();
  }

  // Metadata API methods
  async getMetadata() {
    const response = await fetch(`${this.baseURL}/api/metadata${this.getSessionQuery()}`);
    return response.json();
  }

  async updateItemMetadata(id, updates) {
    const response = await fetch(`${this.baseURL}/api/metadata/item/${id}${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return response.json();
  }

  async createFolder(name) {
    const response = await fetch(`${this.baseURL}/api/metadata/folders${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name }),
    });
    return response.json();
  }

  async renameFolder(name, newName) {
    const response = await fetch(`${this.baseURL}/api/metadata/folders${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', name, newName }),
    });
    return response.json();
  }

  async deleteFolder(name) {
    const response = await fetch(`${this.baseURL}/api/metadata/folders${this.getSessionQuery()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', name }),
    });
    return response.json();
  }

  // WebSocket methods
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsURL = `${protocol}//${window.location.host}/ws`;

    this.setStatus('connecting');
    this.ws = new WebSocket(wsURL);

    this.ws.onopen = () => {
      this.setStatus('connected');
      this.reconnectDelay = 1000;

      // Send any pending messages
      while (this.pendingMessages.length > 0) {
        const message = this.pendingMessages.shift();
        this.ws.send(JSON.stringify(message));
      }
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      for (const listener of this.wsListeners) {
        listener(message);
      }
    };

    this.ws.onclose = () => {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setStatus('disconnected');
    };
  }

  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendWebSocketMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message to be sent when connection opens
      this.pendingMessages.push(message);
    }
  }

  subscribe(id) {
    this.sendWebSocketMessage({ type: 'subscribe', id });
  }

  unsubscribe(id) {
    this.sendWebSocketMessage({ type: 'unsubscribe', id });
  }

  onWebSocketMessage(listener) {
    this.wsListeners.add(listener);
  }

  offWebSocketMessage(listener) {
    this.wsListeners.delete(listener);
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
  }

  setStatus(status) {
    this.connectionStatus = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  scheduleReconnect() {
    setTimeout(() => {
      this.connectWebSocket();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  reconnect() {
    this.reconnectDelay = 1000;
    // Keep pending messages when reconnecting
    this.disconnectWebSocket();
    this.connectWebSocket();
  }
}

export default APIClient;
