import APIClient from './api-client.js';
import { initTheme, toggleTheme } from './theme.js?v=4';
import { transpile, isSmachYaml } from './smach-transpiler.js';
import * as wireframe from './plugins/mermaid-wireframe.js';

const api = new APIClient();

// Thumbnail cache key prefix
const THUMBNAIL_CACHE_PREFIX = 'mermaid-thumb-';
const SESSION_STORAGE_KEY = 'mermaid-collab-session';

let sessions = [];
let diagrams = [];
let documents = [];
let metadata = { folders: [], items: {} };

// DOM elements
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const typeFilter = document.getElementById('type-filter');
const folderFilter = document.getElementById('folder-filter');
const sessionSelector = document.getElementById('session-selector');
const deleteAllBtn = document.getElementById('delete-all');
const themeToggleBtn = document.getElementById('theme-toggle');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Add menu elements
const addBtn = document.getElementById('add-btn');
const addMenu = document.getElementById('add-menu');
const newFolderBtn = document.getElementById('new-folder-btn');
const importFileBtn = document.getElementById('import-file-btn');
const importTextBtn = document.getElementById('import-text-btn');
const manageFoldersBtn = document.getElementById('manage-folders-btn');
const fileInput = document.getElementById('file-input');

// Modal elements
const importTextModal = document.getElementById('import-text-modal');
const importName = document.getElementById('import-name');
const importContent = document.getElementById('import-content');
const importCancel = document.getElementById('import-cancel');
const importSubmit = document.getElementById('import-submit');

const newFolderModal = document.getElementById('new-folder-modal');
const folderNameInput = document.getElementById('folder-name');
const folderCancel = document.getElementById('folder-cancel');
const folderSubmit = document.getElementById('folder-submit');

const manageFoldersModal = document.getElementById('manage-folders-modal');
const foldersList = document.getElementById('folders-list');
const manageClose = document.getElementById('manage-close');

// Get stored session from localStorage
function getStoredSession() {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse stored session:', e);
  }
  return null;
}

// Store session to localStorage
function storeSession(project, session) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ project, session }));
  } catch (e) {
    console.error('Failed to store session:', e);
  }
}

// Clear stored session
function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// Load sessions from server
async function loadSessions() {
  try {
    const response = await api.getSessions();
    sessions = response.sessions || [];
    renderSessionDropdown();

    // Try to restore stored session
    const stored = getStoredSession();
    if (stored) {
      const found = sessions.find(s => s.project === stored.project && s.session === stored.session);
      if (found) {
        sessionSelector.value = `${stored.project}|${stored.session}`;
        api.setSession(stored.project, stored.session);
        await loadItems();
        return;
      } else {
        // Stored session no longer exists
        clearStoredSession();
      }
    }

    // No session selected - show empty state
    renderNoSessionState();
  } catch (error) {
    console.error('Failed to load sessions:', error);
    renderNoSessionState();
  }
}

// Render session dropdown options
function renderSessionDropdown() {
  sessionSelector.innerHTML = '<option value="">Select a session...</option>';

  // Group sessions by project
  const byProject = {};
  for (const s of sessions) {
    const projectName = s.project.split('/').pop() || s.project;
    if (!byProject[projectName]) {
      byProject[projectName] = [];
    }
    byProject[projectName].push(s);
  }

  // Render grouped options
  for (const [projectName, projectSessions] of Object.entries(byProject)) {
    if (projectSessions.length === 1) {
      const s = projectSessions[0];
      const label = `${projectName} / ${s.session}`;
      sessionSelector.innerHTML += `<option value="${s.project}|${s.session}">${label}</option>`;
    } else {
      const optgroup = document.createElement('optgroup');
      optgroup.label = projectName;
      for (const s of projectSessions) {
        const option = document.createElement('option');
        option.value = `${s.project}|${s.session}`;
        option.textContent = s.session;
        optgroup.appendChild(option);
      }
      sessionSelector.appendChild(optgroup);
    }
  }
}

// Show no session selected state
function renderNoSessionState() {
  grid.innerHTML = '';
  empty.style.display = 'block';
  empty.innerHTML = sessions.length === 0
    ? '<p>No sessions available. Start a collab session in Claude to see content here.</p>'
    : '<p>Select a session from the dropdown above to view its content.</p>';
}

// Handle session selection change
sessionSelector.addEventListener('change', async () => {
  const value = sessionSelector.value;
  if (!value) {
    api.clearSession();
    clearStoredSession();
    diagrams = [];
    documents = [];
    metadata = { folders: [], items: {} };
    renderNoSessionState();
    return;
  }

  const [project, session] = value.split('|');
  api.setSession(project, session);
  storeSession(project, session);
  await loadItems();
});

// Load all items
async function loadItems() {
  if (!api.hasSession()) {
    renderNoSessionState();
    return;
  }

  try {
    const [diagramsResponse, documentsResponse, metadataResponse] = await Promise.all([
      api.getDiagrams(),
      api.getDocuments(),
      api.getMetadata().catch(() => ({ folders: [], items: {} })),
    ]);

    diagrams = diagramsResponse.diagrams || [];
    documents = documentsResponse.documents || [];
    // Handle case where metadata endpoint returns error or doesn't exist
    metadata = (metadataResponse && metadataResponse.folders) ? metadataResponse : { folders: [], items: {} };
    updateFolderDropdown();
    renderGrid();
  } catch (error) {
    console.error('Failed to load items:', error);
    if (error.message && error.message.includes('project and session')) {
      renderNoSessionState();
    }
  }
}

// Update folder dropdown options
function updateFolderDropdown() {
  const currentValue = folderFilter.value;
  folderFilter.innerHTML = `
    <option value="all">All Items</option>
    <option value="root">Root</option>
    ${metadata.folders.map(f => `<option value="${f}">${f}</option>`).join('')}
  `;
  // Restore selection if still valid
  if (currentValue === 'all' || currentValue === 'root' || metadata.folders.includes(currentValue)) {
    folderFilter.value = currentValue;
  }
}

// Get item metadata helper
function getItemMeta(id) {
  return metadata.items[id] || { folder: null, locked: false };
}

// Check if content is SMACH YAML (local version for type detection)
function isSmachContent(content) {
  return /^\s*smach_diagram\s*:/m.test(content);
}

// Initialize mermaid for thumbnails
let mermaidInitialized = false;
let mermaidInitPromise = null;
async function initMermaid() {
  if (mermaidInitialized) return;
  if (mermaidInitPromise) return mermaidInitPromise;

  mermaidInitPromise = (async () => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
    });
    // Register wireframe plugin for wireframe diagrams
    await mermaid.registerExternalDiagrams([wireframe]);
    mermaidInitialized = true;
  })();

  return mermaidInitPromise;
}

// Simple hash function for cache keys
function hashContent(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// Get cached thumbnail
function getCachedThumbnail(diagramId, content) {
  const key = THUMBNAIL_CACHE_PREFIX + diagramId + '-' + hashContent(content);
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

// Cache thumbnail
function cacheThumbnail(diagramId, content, svg) {
  const key = THUMBNAIL_CACHE_PREFIX + diagramId + '-' + hashContent(content);
  try {
    localStorage.setItem(key, svg);
  } catch (e) {
    // localStorage might be full, try to clean old entries
    cleanThumbnailCache();
    try {
      localStorage.setItem(key, svg);
    } catch (e2) {
      // Still failed, ignore
    }
  }
}

// Clean old thumbnail cache entries
function cleanThumbnailCache() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(THUMBNAIL_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  // Remove half the cached thumbnails (oldest first would be better but we don't track order)
  const removeCount = Math.ceil(keysToRemove.length / 2);
  for (let i = 0; i < removeCount; i++) {
    localStorage.removeItem(keysToRemove[i]);
  }
}

// Render thumbnails client-side using Mermaid
async function renderThumbnails(items) {
  await initMermaid();

  // Build a map of diagram content
  const diagramContent = {};
  for (const item of items) {
    if (item.type === 'diagram' || item.type === 'smach') {
      diagramContent[item.id] = item.content;
    }
  }

  // Render each thumbnail
  const thumbnailElements = document.querySelectorAll('.mermaid-thumbnail');
  for (const el of thumbnailElements) {
    const diagramId = el.dataset.diagramId;
    let content = diagramContent[diagramId];

    if (!content) continue;

    // Transpile SMACH if needed (for both cache key and rendering)
    let renderContent = content;
    if (isSmachYaml(content)) {
      try {
        const result = transpile(content);
        renderContent = result.mermaid;
      } catch (e) {
        el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 8px;">SMACH error</div>';
        continue;
      }
    }

    // Check cache first
    const cached = getCachedThumbnail(diagramId, content);
    if (cached) {
      el.innerHTML = cached;
      continue;
    }

    try {
      // Render with unique ID
      const uniqueId = `thumb-${diagramId}-${Date.now()}`;
      const { svg } = await mermaid.render(uniqueId, renderContent);
      el.innerHTML = svg;
      // Cache the result
      cacheThumbnail(diagramId, content, svg);
    } catch (error) {
      // Show error placeholder
      el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 8px;">Preview unavailable</div>';
      console.error(`Failed to render thumbnail for ${diagramId}:`, error);
    }
  }
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
  if (!api.hasSession()) {
    renderNoSessionState();
    return;
  }

  const filter = search.value.toLowerCase();
  const typeFilterValue = typeFilter.value;
  const folderFilterValue = folderFilter.value;

  // Combine and filter items
  let items = [];

  // Process diagrams - detect SMACH type
  const processedDiagrams = diagrams.map(d => ({
    ...d,
    type: isSmachContent(d.content) ? 'smach' : 'diagram',
    displayName: d.name.replace('.mmd', ''),
  }));

  if (typeFilterValue === 'all') {
    items.push(...processedDiagrams);
  } else if (typeFilterValue === 'diagram') {
    items.push(...processedDiagrams.filter(d => d.type === 'diagram'));
  } else if (typeFilterValue === 'smach') {
    items.push(...processedDiagrams.filter(d => d.type === 'smach'));
  }

  if (typeFilterValue === 'all' || typeFilterValue === 'document') {
    items.push(...documents.map(d => ({
      ...d,
      type: 'document',
      displayName: d.name.replace('.md', ''),
    })));
  }

  // Filter by folder
  if (folderFilterValue === 'root') {
    items = items.filter(item => {
      const itemMeta = getItemMeta(item.id);
      return itemMeta.folder === null;
    });
  } else if (folderFilterValue !== 'all') {
    items = items.filter(item => {
      const itemMeta = getItemMeta(item.id);
      return itemMeta.folder === folderFilterValue;
    });
  }

  // Filter by search
  items = items.filter(item =>
    item.displayName.toLowerCase().includes(filter)
  );

  // Sort by lastModified (newest first)
  items.sort((a, b) => b.lastModified - a.lastModified);

  // Build folder cards HTML
  let folderCardsHtml = '';

  // Show parent folder button if inside a folder
  if (folderFilterValue !== 'all' && folderFilterValue !== 'root') {
    folderCardsHtml += `
      <div class="item-card folder-card parent-folder" data-folder="root">
        <span class="type-badge folder">Parent</span>
        <div class="item-thumbnail folder-thumbnail">&#8592;</div>
        <div class="item-info">
          <div class="item-name">.. (Back to Root)</div>
          <div class="item-meta"></div>
        </div>
      </div>
    `;
  }

  // Show folders when viewing "All Items" or "Root"
  if (folderFilterValue === 'all' || folderFilterValue === 'root') {
    folderCardsHtml += metadata.folders.map(folder => {
      const folderItems = [...diagrams, ...documents].filter(item => {
        const itemMeta = getItemMeta(item.id);
        return itemMeta.folder === folder;
      });
      const itemCount = folderItems.length;
      const latestModified = folderItems.length > 0
        ? Math.max(...folderItems.map(i => i.lastModified))
        : null;
      const updatedText = latestModified
        ? `Updated ${new Date(latestModified).toLocaleDateString()}`
        : 'Empty';
      return `
        <div class="item-card folder-card" data-folder="${folder}">
          <span class="type-badge folder">Folder</span>
          <div class="item-thumbnail folder-thumbnail">&#128193;</div>
          <div class="item-info">
            <div class="item-name">${folder}</div>
            <div class="item-meta">${itemCount} item${itemCount !== 1 ? 's' : ''} · ${updatedText}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (items.length === 0 && !folderCardsHtml) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.innerHTML = '<p>No items in this folder.</p>';
    return;
  }

  empty.style.display = 'none';

  // Build session query for links
  const sessionQuery = api.getSessionQuery();

  const itemCardsHtml = items.map(item => {
    const itemMeta = getItemMeta(item.id);
    const lockedClass = itemMeta.locked ? 'locked' : '';
    // Unicode lock outlines: 🔓 open, 🔒 closed (but we use simple SVG-style chars for outline look)
    const lockIcon = itemMeta.locked ? '&#128274;' : '&#128275;'; // 🔒 / 🔓
    const lockTitle = itemMeta.locked ? 'Unlock' : 'Lock';
    const deleteTitle = itemMeta.locked ? 'Unlock to delete' : 'Delete';
    const itemType = (item.type === 'diagram' || item.type === 'smach') ? 'diagram' : 'document';

    const moveDropdown = `
      <div class="move-dropdown" data-id="${item.id}">
        <button data-folder="root">Move to Root</button>
        ${metadata.folders.map(f => `<button data-folder="${f}">${f}</button>`).join('')}
        <hr>
        <button data-folder="__new__">New Folder...</button>
      </div>
    `;

    if (item.type === 'diagram' || item.type === 'smach') {
      const badgeClass = item.type === 'smach' ? 'smach' : 'diagram';
      const badgeText = item.type === 'smach' ? 'SMACH' : 'Diagram';
      return `
        <div class="item-card ${lockedClass}" data-id="${item.id}" data-type="diagram" data-content-type="${item.type}">
          <span class="type-badge ${badgeClass}">${badgeText}</span>
          <button class="delete-btn" data-id="${item.id}" data-type="diagram" title="${deleteTitle}">×</button>
          <div class="item-thumbnail">
            <div class="mermaid-thumbnail" data-diagram-id="${item.id}"></div>
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
          <button class="card-bottom-btn move-btn" data-id="${item.id}" title="Move to folder">&#8594;</button>
          ${moveDropdown}
          <button class="card-bottom-btn lock-btn" data-id="${item.id}" title="${lockTitle}">${lockIcon}</button>
        </div>
      `;
    } else {
      return `
        <div class="item-card ${lockedClass}" data-id="${item.id}" data-type="document">
          <span class="type-badge document">Document</span>
          <button class="delete-btn" data-id="${item.id}" data-type="document" title="${deleteTitle}">×</button>
          <div class="item-thumbnail document-preview">
            ${getDocumentPreview(item.content)}
          </div>
          <div class="item-info">
            <div class="item-name">${item.displayName}</div>
            <div class="item-meta">
              Updated ${new Date(item.lastModified).toLocaleDateString()}
            </div>
          </div>
          <button class="card-bottom-btn move-btn" data-id="${item.id}" title="Move to folder">&#8594;</button>
          ${moveDropdown}
          <button class="card-bottom-btn lock-btn" data-id="${item.id}" title="${lockTitle}">${lockIcon}</button>
        </div>
      `;
    }
  }).join('');

  grid.innerHTML = folderCardsHtml + itemCardsHtml;

  // Render thumbnails client-side
  renderThumbnails(items);

  // Add click handlers for folder cards
  document.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', () => {
      const folder = card.dataset.folder;
      folderFilter.value = folder;
      renderGrid();
    });
  });

  // Add click handlers for item cards (not folder cards)
  document.querySelectorAll('.item-card:not(.folder-card)').forEach(card => {
    card.addEventListener('click', (e) => {
      // Ignore clicks on buttons and dropdowns
      if (e.target.closest('.delete-btn') ||
          e.target.closest('.lock-btn') ||
          e.target.closest('.move-btn') ||
          e.target.closest('.move-dropdown')) return;

      const id = card.dataset.id;
      const type = card.dataset.type;

      if (type === 'diagram') {
        window.location.href = `/diagram.html?id=${id}${sessionQuery.replace('?', '&')}`;
      } else {
        window.location.href = `/document.html?id=${id}${sessionQuery.replace('?', '&')}`;
      }
    });
  });

  // Add click handlers for move buttons
  document.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all other dropdowns first
      document.querySelectorAll('.move-dropdown.open').forEach(d => d.classList.remove('open'));
      const dropdown = btn.parentElement.querySelector('.move-dropdown');
      dropdown.classList.toggle('open');
    });
  });

  // Add click handlers for move dropdown options
  document.querySelectorAll('.move-dropdown button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const dropdown = btn.closest('.move-dropdown');
      const itemId = dropdown.dataset.id;
      const targetFolder = btn.dataset.folder;

      dropdown.classList.remove('open');

      if (targetFolder === '__new__') {
        const newFolderName = prompt('New folder name:');
        if (newFolderName) {
          try {
            await api.createFolder(newFolderName);
            await api.updateItemMetadata(itemId, { folder: newFolderName });
            await loadItems();
          } catch (error) {
            alert('Failed to create folder: ' + error.message);
          }
        }
      } else {
        try {
          const folder = targetFolder === 'root' ? null : targetFolder;
          await api.updateItemMetadata(itemId, { folder });
          // Update local metadata
          if (!metadata.items[itemId]) {
            metadata.items[itemId] = { folder: null, locked: false };
          }
          metadata.items[itemId].folder = folder;
          renderGrid();
        } catch (error) {
          alert('Failed to move item: ' + error.message);
        }
      }
    });
  });

  // Close move dropdowns when clicking elsewhere
  document.addEventListener('click', () => {
    document.querySelectorAll('.move-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  // Add click handlers for lock buttons
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const id = btn.dataset.id;
      const itemMeta = getItemMeta(id);
      const newLocked = !itemMeta.locked;

      try {
        await api.updateItemMetadata(id, { locked: newLocked });
        // Update local metadata
        if (!metadata.items[id]) {
          metadata.items[id] = { folder: null, locked: false };
        }
        metadata.items[id].locked = newLocked;
        renderGrid();
      } catch (error) {
        alert('Failed to update lock: ' + error.message);
      }
    });
  });

  // Add click handlers for delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();

      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const itemMeta = getItemMeta(id);

      // Prevent deletion of locked items
      if (itemMeta.locked) {
        return;
      }

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

// Get items in current folder view (for delete all)
function getItemsInCurrentView() {
  const folderFilterValue = folderFilter.value;
  let items = [...diagrams, ...documents];

  if (folderFilterValue === 'root') {
    items = items.filter(item => {
      const itemMeta = getItemMeta(item.id);
      return itemMeta.folder === null;
    });
  } else if (folderFilterValue !== 'all') {
    items = items.filter(item => {
      const itemMeta = getItemMeta(item.id);
      return itemMeta.folder === folderFilterValue;
    });
  }

  return items;
}

// Delete all items (respects folder and locks)
async function deleteAllItems() {
  if (!api.hasSession()) {
    alert('Please select a session first.');
    return;
  }

  const folderFilterValue = folderFilter.value;
  const items = getItemsInCurrentView();

  // Filter out locked items
  const unlocked = items.filter(item => !getItemMeta(item.id).locked);
  const lockedCount = items.length - unlocked.length;

  if (unlocked.length === 0) {
    alert('No unlocked items to delete.');
    return;
  }

  const folderName = folderFilterValue === 'all' ? 'all folders' :
                     folderFilterValue === 'root' ? 'Root' : folderFilterValue;
  const lockedMsg = lockedCount > 0 ? ` (${lockedCount} locked items will be kept)` : '';

  if (!confirm(`Delete ${unlocked.length} unlocked items in ${folderName}?${lockedMsg}`)) return;

  try {
    await Promise.all(
      unlocked.map(item => {
        const isDiagram = diagrams.some(d => d.id === item.id);
        return isDiagram ? api.deleteDiagram(item.id) : api.deleteDocument(item.id);
      })
    );
    await loadItems();
  } catch (error) {
    alert('Failed to delete: ' + error.message);
  }
}

// Event listeners
search.addEventListener('input', renderGrid);
typeFilter.addEventListener('change', renderGrid);
folderFilter.addEventListener('change', renderGrid);
deleteAllBtn.addEventListener('click', deleteAllItems);

// Theme toggle
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}

// Add menu dropdown
addBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!api.hasSession()) {
    alert('Please select a session first.');
    return;
  }
  addMenu.classList.toggle('open');
});

document.addEventListener('click', () => {
  addMenu.classList.remove('open');
});

// Detect content type from text
function detectContentType(content) {
  if (/^\s*smach_diagram\s*:/m.test(content)) return 'smach';
  if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey|xychart)/m.test(content)) return 'diagram';
  return 'document';
}

// Import file handler
importFileBtn.addEventListener('click', () => {
  addMenu.classList.remove('open');
  fileInput.click();
});


fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const content = await file.text();
  const baseName = file.name.replace(/\.(mmd|md|txt|yaml|yml)$/, '');
  const type = detectContentType(content);

  try {
    const currentFolder = folderFilter.value;
    const folder = (currentFolder === 'all' || currentFolder === 'root') ? null : currentFolder;

    if (type === 'document') {
      const id = await api.createDocument(baseName, content);
      if (folder) await api.updateItemMetadata(id.id, { folder });
    } else {
      const id = await api.createDiagram(baseName, content);
      if (folder) await api.updateItemMetadata(id.id, { folder });
    }
    await loadItems();
  } catch (error) {
    alert('Failed to import: ' + error.message);
  }

  fileInput.value = '';
});

// Import text modal
importTextBtn.addEventListener('click', () => {
  addMenu.classList.remove('open');
  importTextModal.classList.remove('hidden');
  importName.value = '';
  importContent.value = '';
  importName.focus();
});


importCancel.addEventListener('click', () => {
  importTextModal.classList.add('hidden');
});

importTextModal.addEventListener('click', (e) => {
  if (e.target === importTextModal) {
    importTextModal.classList.add('hidden');
  }
});

importSubmit.addEventListener('click', async () => {
  const name = importName.value.trim();
  const content = importContent.value;

  if (!name) {
    alert('Please enter a name');
    return;
  }
  if (!content) {
    alert('Please enter content');
    return;
  }

  const type = detectContentType(content);

  try {
    const currentFolder = folderFilter.value;
    const folder = (currentFolder === 'all' || currentFolder === 'root') ? null : currentFolder;

    if (type === 'document') {
      const result = await api.createDocument(name, content);
      if (folder) await api.updateItemMetadata(result.id, { folder });
    } else {
      const result = await api.createDiagram(name, content);
      if (folder) await api.updateItemMetadata(result.id, { folder });
    }

    importTextModal.classList.add('hidden');
    await loadItems();
  } catch (error) {
    alert('Failed to import: ' + error.message);
  }
});

// New folder modal
newFolderBtn.addEventListener('click', () => {
  addMenu.classList.remove('open');
  newFolderModal.classList.remove('hidden');
  folderNameInput.value = '';
  folderNameInput.focus();
});

folderCancel.addEventListener('click', () => {
  newFolderModal.classList.add('hidden');
});

newFolderModal.addEventListener('click', (e) => {
  if (e.target === newFolderModal) {
    newFolderModal.classList.add('hidden');
  }
});

folderSubmit.addEventListener('click', async () => {
  const name = folderNameInput.value.trim();
  if (!name) {
    alert('Please enter a folder name');
    return;
  }

  try {
    await api.createFolder(name);
    newFolderModal.classList.add('hidden');
    await loadItems();
    folderFilter.value = name; // Switch to new folder
  } catch (error) {
    alert('Failed to create folder: ' + error.message);
  }
});

// Manage folders modal
manageFoldersBtn.addEventListener('click', () => {
  addMenu.classList.remove('open');
  renderFoldersList();
  manageFoldersModal.classList.remove('hidden');
});

manageClose.addEventListener('click', () => {
  manageFoldersModal.classList.add('hidden');
});

manageFoldersModal.addEventListener('click', (e) => {
  if (e.target === manageFoldersModal) {
    manageFoldersModal.classList.add('hidden');
  }
});

function renderFoldersList() {
  if (metadata.folders.length === 0) {
    foldersList.innerHTML = '<p style="color: var(--text-secondary);">No folders yet.</p>';
    return;
  }

  foldersList.innerHTML = metadata.folders.map(folder => {
    const itemCount = Object.values(metadata.items).filter(m => m.folder === folder).length;
    return `
      <div style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <span style="flex: 1;">${folder} <span style="color: var(--text-secondary);">(${itemCount} items)</span></span>
        <button class="rename-folder-btn icon-btn" data-folder="${folder}" style="width: 28px; height: 28px; font-size: 14px; margin-right: 4px;" title="Rename">R</button>
        <button class="delete-folder-btn icon-btn" data-folder="${folder}" style="width: 28px; height: 28px; font-size: 14px;" title="Delete">x</button>
      </div>
    `;
  }).join('');

  // Add rename handlers
  foldersList.querySelectorAll('.rename-folder-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const oldName = btn.dataset.folder;
      const newName = prompt('New folder name:', oldName);
      if (newName && newName !== oldName) {
        try {
          await api.renameFolder(oldName, newName);
          await loadItems();
          renderFoldersList();
        } catch (error) {
          alert('Failed to rename: ' + error.message);
        }
      }
    });
  });

  // Add delete handlers
  foldersList.querySelectorAll('.delete-folder-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.folder;
      if (confirm(`Delete folder "${name}"? Items will be moved to Root.`)) {
        try {
          await api.deleteFolder(name);
          await loadItems();
          renderFoldersList();
          if (folderFilter.value === name) {
            folderFilter.value = 'root';
            renderGrid();
          }
        } catch (error) {
          alert('Failed to delete: ' + error.message);
        }
      }
    });
  });
}

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  // Only process messages for the current session
  if (message.project && message.session) {
    if (message.project !== api.project || message.session !== api.session) {
      return; // Ignore messages from other sessions
    }
  }

  if (
    message.type === 'diagram_created' ||
    message.type === 'diagram_deleted' ||
    message.type === 'document_created' ||
    message.type === 'document_deleted' ||
    message.type === 'metadata_updated'
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
loadSessions();
