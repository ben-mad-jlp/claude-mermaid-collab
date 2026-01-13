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
  }

  // HTTP API methods
  async getDiagrams() {
    const response = await fetch(`${this.baseURL}/api/diagrams`);
    return response.json();
  }

  async getDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`);
    return response.json();
  }

  async createDiagram(name, content) {
    const response = await fetch(`${this.baseURL}/api/diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    return response.json();
  }

  async updateDiagram(id, content) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  async deleteDiagram(id) {
    const response = await fetch(`${this.baseURL}/api/diagram/${id}`, {
      method: 'DELETE',
    });
    return response.json();
  }

  async validateDiagram(content) {
    const response = await fetch(`${this.baseURL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  getThumbnailURL(id) {
    return `${this.baseURL}/api/thumbnail/${id}`;
  }

  getRenderURL(id, theme = 'default') {
    return `${this.baseURL}/api/render/${id}?theme=${theme}`;
  }

  // Document API methods
  async getDocuments() {
    const response = await fetch(`${this.baseURL}/api/documents`);
    return response.json();
  }

  async getDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}`);
    return response.json();
  }

  async createDocument(name, content) {
    const response = await fetch(`${this.baseURL}/api/document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    return response.json();
  }

  async updateDocument(id, content) {
    const response = await fetch(`${this.baseURL}/api/document/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return response.json();
  }

  async deleteDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}`, {
      method: 'DELETE',
    });
    return response.json();
  }

  async getCleanDocument(id) {
    const response = await fetch(`${this.baseURL}/api/document/${id}/clean`);
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
