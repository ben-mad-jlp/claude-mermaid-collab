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
    this.isCollapsed = false;
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

    // Header
    const header = document.createElement('div');
    header.className = 'session-panel-header';

    const title = document.createElement('span');
    title.className = 'session-panel-header-title';
    title.textContent = 'Session Items';

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.className = 'session-panel-collapse-btn';
    this.collapseBtn.innerHTML = '&#x276E;'; // Left chevron
    this.collapseBtn.title = 'Collapse panel';
    this.collapseBtn.addEventListener('click', () => this.toggle());

    header.appendChild(title);
    header.appendChild(this.collapseBtn);

    // Items list container
    this.itemsContainer = document.createElement('div');
    this.itemsContainer.className = 'session-panel-items';

    // Resize handle
    this.resizer = document.createElement('div');
    this.resizer.className = 'session-panel-resizer';
    this.setupResizer();

    // Assemble panel
    this.panel.appendChild(header);
    this.panel.appendChild(this.itemsContainer);
    this.panel.appendChild(this.resizer);

    // Append to container
    this.container.appendChild(this.panel);

    // Add body class to adjust main content
    document.body.classList.add('has-session-panel');
  }

  /**
   * Set up the resize drag handler
   */
  setupResizer() {
    let startX = 0;
    let startWidth = 0;
    let isDragging = false;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, this.minWidth), this.maxWidth);
      this.resize(newWidth);
    };

    const onMouseUp = () => {
      isDragging = false;
      this.resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    this.resizer.addEventListener('mousedown', (e) => {
      if (this.isCollapsed) return;
      isDragging = true;
      startX = e.clientX;
      startWidth = this.panelWidth;
      this.resizer.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
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
   * Render the items list
   */
  renderItems() {
    this.itemsContainer.innerHTML = '';

    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-panel-empty';
      empty.textContent = 'No items in session';
      this.itemsContainer.appendChild(empty);
      return;
    }

    for (const item of this.items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'session-panel-item';
      itemEl.dataset.id = item.id;

      // Mark as active if it's the current item
      if (item.id === this.currentItemId) {
        itemEl.classList.add('active');
      }

      // Icon
      const icon = document.createElement('span');
      icon.className = 'session-panel-item-icon';
      icon.textContent = item.type === 'document' ? '\u{1F4C4}' : '\u{1F4CA}'; // Document or chart emoji

      // Name
      const name = document.createElement('span');
      name.className = 'session-panel-item-name';
      name.textContent = item.name;
      name.title = item.name;

      // Badge (update indicator)
      const badge = document.createElement('span');
      badge.className = 'session-panel-item-badge';
      badge.style.display = item.hasUpdate && item.id !== this.currentItemId ? 'block' : 'none';

      // New tab button
      const newtabBtn = document.createElement('button');
      newtabBtn.className = 'session-panel-item-newtab';
      newtabBtn.innerHTML = '\u{2197}'; // North-east arrow
      newtabBtn.title = 'Open in new tab';
      newtabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openInNewTab(item.id, item.type);
      });

      // Assemble item
      itemEl.appendChild(icon);
      itemEl.appendChild(name);
      itemEl.appendChild(badge);
      itemEl.appendChild(newtabBtn);

      // Click to navigate
      itemEl.addEventListener('click', () => {
        if (item.id !== this.currentItemId) {
          this.markAsViewed(item.id);
          this.onNavigate(item.id, item.type);
        }
      });

      this.itemsContainer.appendChild(itemEl);
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
   * Collapse the panel
   */
  collapse() {
    this.isCollapsed = true;
    this.panel.classList.add('collapsed');
    this.collapseBtn.title = 'Expand panel';
    document.body.classList.add('panel-collapsed');
  }

  /**
   * Expand the panel
   */
  expand() {
    this.isCollapsed = false;
    this.panel.classList.remove('collapsed');
    this.collapseBtn.title = 'Collapse panel';
    document.body.classList.remove('panel-collapsed');
  }

  /**
   * Toggle collapsed state
   */
  toggle() {
    if (this.isCollapsed) {
      this.expand();
    } else {
      this.collapse();
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

    // Update the container margin-left directly for immediate feedback
    const container = document.querySelector('.container');
    if (container) {
      container.style.marginLeft = `${width}px`;
      container.style.maxWidth = `calc(1400px - ${width}px)`;
    }
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

    // Remove body classes
    document.body.classList.remove('has-session-panel');
    document.body.classList.remove('panel-collapsed');

    // Reset container styles
    const container = document.querySelector('.container');
    if (container) {
      container.style.marginLeft = '';
      container.style.maxWidth = '';
    }
  }
}

export default SessionPanel;
