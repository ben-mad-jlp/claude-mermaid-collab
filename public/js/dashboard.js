import APIClient from './api-client.js';
import { initTheme, toggleTheme } from './theme.js';

const api = new APIClient();
let diagrams = [];
let documents = [];

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const typeFilter = document.getElementById('type-filter');
const deleteAllBtn = document.getElementById('delete-all');
const themeToggleBtn = document.getElementById('theme-toggle');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Load all items
async function loadItems() {
  const [diagramsResponse, documentsResponse] = await Promise.all([
    api.getDiagrams(),
    api.getDocuments(),
  ]);

  diagrams = diagramsResponse.diagrams || [];
  documents = documentsResponse.documents || [];
  renderGrid();
}

// Get preview text for document (first ~100 chars or first heading)
function getDocumentPreview(content) {
  // Try to find first heading
  const headingMatch = content.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1];
  }

  // Fall back to first 100 chars
  const clean = content
    .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
    .replace(/^#+\s*/gm, '')         // Remove heading markers
    .trim();

  return clean.substring(0, 100) + (clean.length > 100 ? '...' : '');
}

// Render grid
function renderGrid() {
  const filter = search.value.toLowerCase();
  const typeFilterValue = typeFilter.value;

  // Combine and filter items
  let items = [];

  if (typeFilterValue === 'all' || typeFilterValue === 'diagram') {
    items.push(...diagrams.map(d => ({
      ...d,
      type: 'diagram',
      displayName: d.name.replace('.mmd', ''),
    })));
  }

  if (typeFilterValue === 'all' || typeFilterValue === 'document') {
    items.push(...documents.map(d => ({
      ...d,
      type: 'document',
      displayName: d.name.replace('.md', ''),
    })));
  }

  // Filter by search
  items = items.filter(item =>
    item.displayName.toLowerCase().includes(filter)
  );

  // Sort by lastModified (newest first)
  items.sort((a, b) => b.lastModified - a.lastModified);

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = items.map(item => {
    if (item.type === 'diagram') {
      return `
        <div class="item-card" data-id="${item.id}" data-type="diagram">
          <span class="type-badge diagram">Diagram</span>
          <button class="delete-btn" data-id="${item.id}" data-type="diagram" title="Delete">×</button>
          <div class="item-thumbnail">
            <img src="${api.getThumbnailURL(item.id)}" alt="${item.displayName}">
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="item-card" data-id="${item.id}" data-type="document">
          <span class="type-badge document">Document</span>
          <button class="delete-btn" data-id="${item.id}" data-type="document" title="Delete">×</button>
          <div class="item-thumbnail document-preview">
            ${getDocumentPreview(item.content)}
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');

  // Add click handlers for cards
  document.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;

      const id = card.dataset.id;
      const type = card.dataset.type;

      if (type === 'diagram') {
        window.location.href = `/diagram.html?id=${id}`;
      } else {
        window.location.href = `/document.html?id=${id}`;
      }
    });
  });

  // Add click handlers for delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const id = btn.dataset.id;
      const type = btn.dataset.type;

      try {
        if (type === 'diagram') {
          await api.deleteDiagram(id);
        } else {
          await api.deleteDocument(id);
        }
        await loadItems();
      } catch (error) {
        alert('Failed to delete: ' + error.message);
      }
    });
  });
}

// Delete all items
async function deleteAllItems() {
  if (!confirm('Delete all diagrams and documents?')) return;

  try {
    await Promise.all([
      ...diagrams.map(d => api.deleteDiagram(d.id)),
      ...documents.map(d => api.deleteDocument(d.id)),
    ]);
    await loadItems();
  } catch (error) {
    alert('Failed to delete: ' + error.message);
  }
}

// Event listeners
search.addEventListener('input', renderGrid);
typeFilter.addEventListener('change', renderGrid);
deleteAllBtn.addEventListener('click', deleteAllItems);

// Theme toggle
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (
    message.type === 'diagram_created' ||
    message.type === 'diagram_deleted' ||
    message.type === 'document_created' ||
    message.type === 'document_deleted'
  ) {
    loadItems();
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Initialize
initTheme();
api.connectWebSocket();
loadItems();
