import APIClient from './api-client.js';

const api = new APIClient();
let diagrams = [];

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const deleteAllBtn = document.getElementById('delete-all');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Load diagrams
async function loadDiagrams() {
  const response = await api.getDiagrams();
  diagrams = response.diagrams;
  renderGrid();
}

// Render grid
function renderGrid(filter = '') {
  const filtered = diagrams.filter(d =>
    d.name.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  grid.innerHTML = filtered.map(diagram => `
    <div class="diagram-card" data-id="${diagram.id}">
      <button class="delete-btn" data-id="${diagram.id}" title="Delete diagram">×</button>
      <div class="diagram-thumbnail">
        <img src="${api.getThumbnailURL(diagram.id)}" alt="${diagram.name}">
      </div>
      <div class="diagram-info">
        <div class="diagram-name">${diagram.name}</div>
        <div class="diagram-meta">
          Updated ${new Date(diagram.lastModified).toLocaleDateString()}
        </div>
      </div>
    </div>
  `).join('');

  // Add click handlers for cards
  document.querySelectorAll('.diagram-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking delete button
      if (e.target.classList.contains('delete-btn')) return;

      const id = card.dataset.id;
      window.location.href = `/diagram.html?id=${id}`;
    });
  });

  // Add click handlers for delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent card click

      const id = btn.dataset.id;

      try {
        await api.deleteDiagram(id);
        await loadDiagrams(); // Reload the list
      } catch (error) {
        alert('Failed to delete diagram: ' + error.message);
      }
    });
  });
}

// Delete all diagrams
async function deleteAllDiagrams() {
  try {
    // Delete all diagrams in parallel
    await Promise.all(diagrams.map(d => api.deleteDiagram(d.id)));
    await loadDiagrams(); // Reload the list
  } catch (error) {
    alert('Failed to delete diagrams: ' + error.message);
  }
}

// Search
search.addEventListener('input', (e) => {
  renderGrid(e.target.value);
});

// Delete all button
deleteAllBtn.addEventListener('click', deleteAllDiagrams);

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'diagram_created' || message.type === 'diagram_deleted') {
    loadDiagrams();
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Initialize
api.connectWebSocket();
loadDiagrams();
