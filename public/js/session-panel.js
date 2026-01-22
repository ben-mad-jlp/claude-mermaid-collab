/**
 * Session Panel - Left sidebar showing all session items
 * Provides navigation, update notifications, and real-time updates
 */

class SessionPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Container element to render panel into
   * @param {APIClient} options.api - API client instance
   * @param {string} options.currentItemId - ID of the currently viewed item
   * @param {'document'|'diagram'} options.currentItemType - Type of the currently viewed item
   * @param {function(string, 'document'|'diagram'): void} options.onNavigate - Callback when user navigates to an item
   */
  constructor(options) {
    this.container = options.container;
    this.api = options.api;
    this.currentItemId = options.currentItemId;
    this.currentItemType = options.currentItemType;
    this.onNavigate = options.onNavigate;

    // State
    this.items = [];
    this.viewedItems = this.loadViewedItems();
    this.panelWidth = 200;
    this.minWidth = 150;
    this.maxWidth = 400;

    // WebSocket listener reference for cleanup
    this.wsListener = null;

    // Create DOM structure
    this.createDOM();
  }

  /**
   * Load viewed items from localStorage
   * @returns {Set<string>}
   */
  loadViewedItems() {
    try {
      const stored = localStorage.getItem('session-panel-viewed');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed to load viewed items from localStorage:', e);
    }
    return new Set();
  }

  /**
   * Save viewed items to localStorage
   */
  saveViewedItems() {
    try {
      localStorage.setItem('session-panel-viewed', JSON.stringify([...this.viewedItems]));
    } catch (e) {
      console.warn('Failed to save viewed items to localStorage:', e);
    }
  }

  /**
   * Create the DOM structure for the panel
   */
  createDOM() {
    // Main panel wrapper
    this.panel = document.createElement('div');
    this.panel.className = 'session-panel';

    // Items list container
    this.itemsContainer = document.createElement('div');
    this.itemsContainer.className = 'session-panel-items';

    // Assemble panel
    this.panel.appendChild(this.itemsContainer);

    // Append to container
    this.container.appendChild(this.panel);
  }

  /**
   * Initialize the panel - load items and set up listeners
   */
  async initialize() {
    // Show loading state
    this.itemsContainer.innerHTML = '<div class="session-panel-loading">Loading...</div>';

    // Load initial data
    await this.refreshItems();

    // Set up WebSocket listeners
    this.wsListener = (message) => {
      switch (message.type) {
        case 'document_created':
          this.handleItemCreated(message.id, message.name, 'document');
          break;
        case 'document_updated':
          this.handleItemUpdated(message.id, message.lastModified);
          break;
        case 'document_deleted':
          this.handleItemDeleted(message.id);
          break;
        case 'diagram_created':
          this.handleItemCreated(message.id, message.name, 'diagram');
          break;
        case 'diagram_updated':
          this.handleItemUpdated(message.id, message.lastModified);
          break;
        case 'diagram_deleted':
          this.handleItemDeleted(message.id);
          break;
      }
    };
    this.api.onWebSocketMessage(this.wsListener);

    // Mark current item as viewed
    this.markAsViewed(this.currentItemId);
  }

  /**
   * Refresh the items list from the server
   */
  async refreshItems() {
    try {
      // Fetch both documents and diagrams
      const [docsResponse, diagramsResponse] = await Promise.all([
        this.api.getDocuments(),
        this.api.getDiagrams()
      ]);

      // Merge into unified list
      this.items = [];

      if (docsResponse.documents) {
        for (const doc of docsResponse.documents) {
          this.items.push({
            id: doc.id,
            name: doc.name,
            type: 'document',
            lastModified: doc.lastModified,
            hasUpdate: !this.viewedItems.has(doc.id)
          });
        }
      }

      if (diagramsResponse.diagrams) {
        for (const diagram of diagramsResponse.diagrams) {
          this.items.push({
            id: diagram.id,
            name: diagram.name,
            type: 'diagram',
            lastModified: diagram.lastModified,
            hasUpdate: !this.viewedItems.has(diagram.id)
          });
        }
      }

      // Sort by lastModified descending (most recent first)
      this.items.sort((a, b) => b.lastModified - a.lastModified);

      // Render the items
      this.renderItems();
    } catch (error) {
      console.error('Failed to refresh session items:', error);
      this.itemsContainer.innerHTML = '<div class="session-panel-empty">Failed to load items</div>';
    }
  }

  /**
   * Create a DOM element with optional class name
   * @param {string} tag - HTML tag name
   * @param {string} [className] - Optional class name
   * @returns {HTMLElement}
   */
  createElement(tag, className) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    return el;
  }

  /**
   * Format a timestamp as relative time
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {string}
   */
  formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000); // seconds

    if (diff < 60) {
      return 'just now';
    }

    const minutes = Math.floor(diff / 60);
    if (minutes < 60) {
      return `${minutes} min ago`;
    }

    const hours = Math.floor(diff / 3600);
    if (hours < 24) {
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }

    const days = Math.floor(diff / 86400);
    if (days < 7) {
      return days === 1 ? '1 day ago' : `${days} days ago`;
    }

    // Fallback to date format
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Render the items as thumbnail cards
   */
  renderItems() {
    this.itemsContainer.innerHTML = '';

    if (this.items.length === 0) {
      // Show empty state
      return;
    }

    for (const item of this.items) {
      // Create card container
      const card = this.createElement('div', 'session-panel-card');
      card.dataset.id = item.id;

      // Mark active item
      if (item.id === this.currentItemId) {
        card.classList.add('active');
      }

      // Create header with type and timestamp
      const header = this.createElement('div', 'session-panel-card-header');

      const typeLabel = this.createElement('span', 'session-panel-card-type');
      typeLabel.textContent = item.type === 'diagram' ? 'Diagram' : 'Document';

      const timeLabel = this.createElement('span', 'session-panel-card-time');
      timeLabel.textContent = this.formatRelativeTime(item.lastModified);

      header.appendChild(typeLabel);
      header.appendChild(timeLabel);

      // Create name label
      const name = this.createElement('div', 'session-panel-card-name');
      name.textContent = item.name;
      name.title = item.name;

      // Assemble card
      card.appendChild(header);
      card.appendChild(name);

      // Click handler
      card.addEventListener('click', () => {
        if (item.id !== this.currentItemId) {
          this.markAsViewed(item.id);
          this.onNavigate(item.id, item.type);
        }
      });

      this.itemsContainer.appendChild(card);
    }
  }

  /**
   * Open an item in a new tab
   * @param {string} id
   * @param {'document'|'diagram'} type
   */
  openInNewTab(id, type) {
    const project = encodeURIComponent(this.api.project);
    const session = encodeURIComponent(this.api.session);
    const url = `/${type}.html?id=${id}&project=${project}&session=${session}`;
    window.open(url, '_blank');
  }

  /**
   * Handle item created event
   * @param {string} id
   * @param {string} name
   * @param {'document'|'diagram'} type
   */
  handleItemCreated(id, name, type) {
    // Add new item
    const newItem = {
      id,
      name,
      type,
      lastModified: Date.now(),
      hasUpdate: id !== this.currentItemId
    };
    this.items.push(newItem);

    // Re-sort by lastModified
    this.items.sort((a, b) => b.lastModified - a.lastModified);

    // Re-render
    this.renderItems();
  }

  /**
   * Handle item updated event
   * @param {string} id
   * @param {number} lastModified
   */
  handleItemUpdated(id, lastModified) {
    // Find the item
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    // Update lastModified
    item.lastModified = lastModified || Date.now();

    // Set hasUpdate if not current item
    if (id !== this.currentItemId) {
      item.hasUpdate = true;
    }

    // Re-sort by lastModified
    this.items.sort((a, b) => b.lastModified - a.lastModified);

    // Re-render
    this.renderItems();

    // Trigger flash animation
    if (id !== this.currentItemId) {
      const itemEl = this.itemsContainer.querySelector(`[data-id="${id}"]`);
      if (itemEl) {
        itemEl.classList.add('flash');
        setTimeout(() => {
          itemEl.classList.remove('flash');
        }, 1000);
      }
    }
  }

  /**
   * Handle item deleted event
   * @param {string} id
   */
  handleItemDeleted(id) {
    // Remove from items array
    this.items = this.items.filter(i => i.id !== id);

    // Remove from viewedItems
    this.viewedItems.delete(id);
    this.saveViewedItems();

    // Re-render
    this.renderItems();
  }

  /**
   * Mark an item as viewed (clear update badge)
   * @param {string} id
   */
  markAsViewed(id) {
    // Add to viewed set
    this.viewedItems.add(id);

    // Clear hasUpdate on item
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.hasUpdate = false;
    }

    // Save to localStorage
    this.saveViewedItems();

    // Update DOM to remove badge
    const itemEl = this.itemsContainer.querySelector(`[data-id="${id}"]`);
    if (itemEl) {
      const badge = itemEl.querySelector('.session-panel-item-badge');
      if (badge) {
        badge.style.display = 'none';
      }
    }
  }


  /**
   * Resize the panel width
   * @param {number} width
   */
  resize(width) {
    this.panelWidth = width;
    this.panel.style.width = `${width}px`;

    // Update body CSS variable for main content offset
    document.documentElement.style.setProperty('--session-panel-width', `${width}px`);
  }

  /**
   * Clean up the panel
   */
  destroy() {
    // Remove WebSocket listener
    if (this.wsListener) {
      this.api.offWebSocketMessage(this.wsListener);
      this.wsListener = null;
    }

    // Remove DOM
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }

    // Remove body class for collapsed state
    document.body.classList.remove('panel-collapsed');
  }
}

export default SessionPanel;
