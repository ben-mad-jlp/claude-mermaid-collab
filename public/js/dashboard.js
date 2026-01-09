const api = new APIClient();
let diagrams = [];

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
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

  // Add click handlers
  document.querySelectorAll('.diagram-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      window.location.href = `/diagram.html?id=${id}`;
    });
  });
}

// Search
search.addEventListener('input', (e) => {
  renderGrid(e.target.value);
});

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
