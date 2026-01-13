import APIClient from './api-client.js';

const api = new APIClient();

// DOM elements
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewPane = document.getElementById('preview-pane');
const title = document.getElementById('title');
const backButton = document.getElementById('back-button');
const addCommentBtn = document.getElementById('add-comment');
const approveSectionBtn = document.getElementById('approve-section');
const rejectSectionBtn = document.getElementById('reject-section');
const exportSelect = document.getElementById('export-select');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const resizer = document.getElementById('resizer');
const tooltip = document.getElementById('tooltip');

// State
let documentId = null;
let saveTimeout = null;
let isUpdatingFromServer = false;
let isSyncing = false;

// Get document ID from URL
const params = new URLSearchParams(window.location.search);
documentId = params.get('id');

if (!documentId) {
  window.location.href = '/';
}

// Load document
async function loadDocument() {
  const doc = await api.getDocument(documentId);
  if (doc.error) {
    alert('Document not found');
    window.location.href = '/';
    return;
  }

  title.textContent = doc.name;
  document.title = `${doc.name} - Document Editor`;
  editor.value = doc.content;
  renderPreview();
}

// Render markdown preview with custom processing
function renderPreview() {
  let content = editor.value;

  // Process status markers - wrap sections
  content = processStatusMarkers(content);

  // Process comment markers
  content = processCommentMarkers(content);

  // Render markdown
  preview.innerHTML = marked.parse(content);

  // Add tooltip handlers for inline comments
  setupTooltips();
}

// Process <!-- status: approved/rejected --> markers
function processStatusMarkers(content) {
  const lines = content.split('\n');
  const result = [];
  let currentStatus = null;
  let sectionContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for heading
    if (line.match(/^#{1,6}\s/)) {
      // Close previous section if open
      if (currentStatus && sectionContent.length > 0) {
        result.push(`<div class="section-${currentStatus}">`);
        result.push(...sectionContent);
        result.push('</div>');
        sectionContent = [];
      }
      currentStatus = null;
      result.push(line);
      continue;
    }

    // Check for status marker
    const statusMatch = line.match(/<!--\s*status:\s*(approved|rejected)\s*-->/);
    if (statusMatch) {
      currentStatus = statusMatch[1];
      continue; // Don't include the marker in output
    }

    // Add line to current section or result
    if (currentStatus) {
      sectionContent.push(line);
    } else {
      result.push(line);
    }
  }

  // Close final section if open
  if (currentStatus && sectionContent.length > 0) {
    result.push(`<div class="section-${currentStatus}">`);
    result.push(...sectionContent);
    result.push('</div>');
  }

  return result.join('\n');
}

// Process comment markers
function processCommentMarkers(content) {
  // Standalone comments: <!-- comment: text -->
  content = content.replace(
    /<!--\s*comment:\s*([^>]+)-->/g,
    '<div class="comment-block">$1</div>'
  );

  // Inline comments: <!-- comment-start: text -->...<!-- comment-end -->
  content = content.replace(
    /<!--\s*comment-start:\s*([^>]+)-->([\s\S]*?)<!--\s*comment-end\s*-->/g,
    '<span class="comment-inline" data-comment="$1">$2</span>'
  );

  return content;
}

// Setup tooltip handlers for inline comments
function setupTooltips() {
  const inlineComments = preview.querySelectorAll('.comment-inline');

  inlineComments.forEach(el => {
    el.addEventListener('mouseenter', (e) => {
      const comment = el.dataset.comment;
      tooltip.textContent = comment;
      tooltip.style.display = 'block';

      const rect = el.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.top = (rect.bottom + 8) + 'px';
    });

    el.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

// Save document with debounce
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (isUpdatingFromServer) return;

    await api.updateDocument(documentId, editor.value);
  }, 500);
}

// Find the nearest heading before cursor position
function findNearestHeading(text, cursorPos) {
  const beforeCursor = text.substring(0, cursorPos);
  const lines = beforeCursor.split('\n');

  // Find last heading line
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^#{1,6}\s/)) {
      // Calculate position after this heading line
      let pos = 0;
      for (let j = 0; j <= i; j++) {
        pos += lines[j].length + 1; // +1 for newline
      }
      return pos;
    }
  }

  return 0; // No heading found, return start
}

// Insert text at position
function insertAtPosition(pos, text) {
  const before = editor.value.substring(0, pos);
  const after = editor.value.substring(pos);
  editor.value = before + text + after;
  renderPreview();
  scheduleSave();
}

// Add comment button handler
addCommentBtn.addEventListener('click', () => {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;

  if (start !== end) {
    // Wrap selection with inline comment
    const before = editor.value.substring(0, start);
    const selected = editor.value.substring(start, end);
    const after = editor.value.substring(end);

    const comment = prompt('Enter comment:');
    if (comment) {
      editor.value = before +
        `<!-- comment-start: ${comment} -->` +
        selected +
        '<!-- comment-end -->' +
        after;
      renderPreview();
      scheduleSave();
    }
  } else {
    // Insert standalone comment at cursor
    const comment = prompt('Enter comment:');
    if (comment) {
      const before = editor.value.substring(0, start);
      const after = editor.value.substring(start);
      editor.value = before + `\n<!-- comment: ${comment} -->\n` + after;
      renderPreview();
      scheduleSave();
    }
  }
});

// Approve section button handler
approveSectionBtn.addEventListener('click', () => {
  const cursorPos = editor.selectionStart;
  const insertPos = findNearestHeading(editor.value, cursorPos);

  // Remove any existing status marker for this section first
  const lines = editor.value.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)\s*-->/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert approved status
  insertAtPosition(insertPos, '<!-- status: approved -->\n');
});

// Reject section button handler
rejectSectionBtn.addEventListener('click', () => {
  const cursorPos = editor.selectionStart;
  const insertPos = findNearestHeading(editor.value, cursorPos);

  // Remove any existing status marker for this section first
  const lines = editor.value.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)\s*-->/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert rejected status
  insertAtPosition(insertPos, '<!-- status: rejected -->\n');
});

// Export handler
exportSelect.addEventListener('change', async () => {
  const value = exportSelect.value;
  if (!value) return;

  let content;
  let filename;

  if (value === 'clean') {
    const result = await api.getCleanDocument(documentId);
    content = result.content;
    filename = documentId + '-clean.md';
  } else {
    content = editor.value;
    filename = documentId + '.md';
  }

  // Download
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  exportSelect.value = '';
});

// Back button
backButton.addEventListener('click', () => {
  window.location.href = '/';
});

// Editor input handler
editor.addEventListener('input', () => {
  renderPreview();
  scheduleSave();
});

// Synchronized scrolling
let editorScrolling = false;
let previewScrolling = false;

editor.addEventListener('scroll', () => {
  if (previewScrolling) return;
  editorScrolling = true;

  const percentage = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
  previewPane.scrollTop = percentage * (previewPane.scrollHeight - previewPane.clientHeight);

  setTimeout(() => { editorScrolling = false; }, 50);
});

previewPane.addEventListener('scroll', () => {
  if (editorScrolling) return;
  previewScrolling = true;

  const percentage = previewPane.scrollTop / (previewPane.scrollHeight - previewPane.clientHeight);
  editor.scrollTop = percentage * (editor.scrollHeight - editor.clientHeight);

  setTimeout(() => { previewScrolling = false; }, 50);
});

// Resizer functionality
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const container = document.querySelector('.split-pane');
  const containerRect = container.getBoundingClientRect();
  const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;

  const editorPane = document.querySelector('.editor-pane');
  editorPane.style.flex = `0 0 ${Math.min(Math.max(percentage, 20), 80)}%`;
});

document.addEventListener('mouseup', () => {
  isResizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// WebSocket handlers
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'document_updated' && message.id === documentId) {
    // Only update if content differs (avoid cursor jump)
    if (message.content !== editor.value) {
      isUpdatingFromServer = true;
      const scrollPos = editor.scrollTop;
      const cursorPos = editor.selectionStart;

      editor.value = message.content;
      renderPreview();

      editor.scrollTop = scrollPos;
      editor.selectionStart = cursorPos;
      editor.selectionEnd = cursorPos;

      setTimeout(() => { isUpdatingFromServer = false; }, 100);
    }
  }

  if (message.type === 'document_deleted' && message.id === documentId) {
    alert('This document has been deleted');
    window.location.href = '/';
  }
});

// Initialize
api.connectWebSocket();
api.subscribe(documentId);
loadDocument();
