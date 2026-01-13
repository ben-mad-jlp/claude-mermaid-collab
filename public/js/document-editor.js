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
  let currentReason = null;
  let sectionContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for heading
    if (line.match(/^#{1,6}\s/)) {
      // Close previous section if open
      if (currentStatus && sectionContent.length > 0) {
        result.push(`<div class="section-${currentStatus}">`);
        if (currentStatus === 'rejected' && currentReason) {
          result.push(`<div class="rejection-reason">Rejected: ${currentReason}</div>`);
        }
        result.push(...sectionContent);
        result.push('</div>');
        sectionContent = [];
      }
      currentStatus = null;
      currentReason = null;
      result.push(line);
      continue;
    }

    // Check for status marker - approved or rejected (with optional reason)
    const approvedMatch = line.match(/<!--\s*status:\s*approved\s*-->/);
    const rejectedMatch = line.match(/<!--\s*status:\s*rejected(?::\s*([^>]+))?\s*-->/);

    if (approvedMatch) {
      currentStatus = 'approved';
      currentReason = null;
      continue;
    }

    if (rejectedMatch) {
      currentStatus = 'rejected';
      currentReason = rejectedMatch[1] ? rejectedMatch[1].trim() : null;
      continue;
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
    if (currentStatus === 'rejected' && currentReason) {
      result.push(`<div class="rejection-reason">Rejected: ${currentReason}</div>`);
    }
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
    '<span class="comment-inline"><span class="comment-inline-text">Comment: $1</span>$2</span>'
  );

  // Inline rejections: <!-- reject-start: reason -->...<!-- reject-end -->
  content = content.replace(
    /<!--\s*reject-start:\s*([^>]+)-->([\s\S]*?)<!--\s*reject-end\s*-->/g,
    '<span class="reject-inline"><span class="reject-inline-reason">Rejected: $1</span>$2</span>'
  );

  // Inline approvals: <!-- approve-start -->...<!-- approve-end -->
  content = content.replace(
    /<!--\s*approve-start\s*-->([\s\S]*?)<!--\s*approve-end\s*-->/g,
    '<span class="approve-inline">$1</span>'
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
    // Wrap selection with inline comment - insert stub for user to edit
    const before = editor.value.substring(0, start);
    const selected = editor.value.substring(start, end);
    const after = editor.value.substring(end);

    const stub = 'your comment here';
    const commentStart = `<!-- comment-start: ${stub} -->`;
    editor.value = before + commentStart + selected + '<!-- comment-end -->' + after;

    // Position cursor inside the stub text for easy editing
    const stubStart = before.length + '<!-- comment-start: '.length;
    editor.selectionStart = stubStart;
    editor.selectionEnd = stubStart + stub.length;
    editor.focus();

    renderPreview();
    scheduleSave();
  } else {
    // Insert standalone comment at cursor - insert stub for user to edit
    const before = editor.value.substring(0, start);
    const after = editor.value.substring(start);

    const stub = 'your comment here';
    const comment = `\n<!-- comment: ${stub} -->\n`;
    editor.value = before + comment + after;

    // Position cursor inside the stub text for easy editing
    const stubStart = before.length + '\n<!-- comment: '.length;
    editor.selectionStart = stubStart;
    editor.selectionEnd = stubStart + stub.length;
    editor.focus();

    renderPreview();
    scheduleSave();
  }
});

// Approve section button handler
approveSectionBtn.addEventListener('click', () => {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;

  // Case 1: Text is selected - use inline approval
  if (start !== end) {
    const before = editor.value.substring(0, start);
    const selected = editor.value.substring(start, end);
    const after = editor.value.substring(end);

    editor.value = before + '<!-- approve-start -->' + selected + '<!-- approve-end -->' + after;
    editor.selectionStart = start;
    editor.selectionEnd = start;
    editor.focus();

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 2: Cursor is on a list item - wrap content after list marker
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(editor.value, start);
  const listParts = parseListItem(lineContent);
  if (listParts) {
    const before = editor.value.substring(0, lineStart);
    const after = editor.value.substring(lineEnd);

    // Keep list marker outside, wrap only the content
    const newLine = listParts.marker + '<!-- approve-start -->' + listParts.content + '<!-- approve-end -->';
    editor.value = before + newLine + after;

    editor.selectionStart = lineStart;
    editor.selectionEnd = lineStart;
    editor.focus();

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section approval (under a heading)
  const cursorPos = start;
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

  // Check if next line is a status marker and remove it (handles rejected with reason too)
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert approved status
  insertAtPosition(insertPos, '<!-- status: approved -->\n');
});

// Helper: get the current line info at cursor position
function getCurrentLineInfo(text, cursorPos) {
  const beforeCursor = text.substring(0, cursorPos);
  const lineStart = beforeCursor.lastIndexOf('\n') + 1;
  const afterCursor = text.substring(cursorPos);
  const lineEndOffset = afterCursor.indexOf('\n');
  const lineEnd = lineEndOffset === -1 ? text.length : cursorPos + lineEndOffset;
  const lineContent = text.substring(lineStart, lineEnd);
  return { lineStart, lineEnd, lineContent };
}

// Helper: parse a list item into marker and content
function parseListItem(line) {
  // Match bullet lists: - , * , + (with optional leading whitespace)
  const bulletMatch = line.match(/^(\s*[-*+]\s)(.*)$/);
  if (bulletMatch) {
    return { marker: bulletMatch[1], content: bulletMatch[2] };
  }
  // Match numbered lists: 1. , 2. , etc (with optional leading whitespace)
  const numberMatch = line.match(/^(\s*\d+\.\s)(.*)$/);
  if (numberMatch) {
    return { marker: numberMatch[1], content: numberMatch[2] };
  }
  return null;
}

// Reject section button handler
rejectSectionBtn.addEventListener('click', () => {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const stub = 'your reason here';

  // Case 1: Text is selected - use inline rejection
  if (start !== end) {
    const before = editor.value.substring(0, start);
    const selected = editor.value.substring(start, end);
    const after = editor.value.substring(end);

    const rejectStart = `<!-- reject-start: ${stub} -->`;
    editor.value = before + rejectStart + selected + '<!-- reject-end -->' + after;

    // Position cursor inside the stub text
    const stubStart = before.length + '<!-- reject-start: '.length;
    editor.selectionStart = stubStart;
    editor.selectionEnd = stubStart + stub.length;
    editor.focus();

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 2: Cursor is on a list item - wrap content after list marker
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(editor.value, start);
  const listParts = parseListItem(lineContent);
  if (listParts) {
    const before = editor.value.substring(0, lineStart);
    const after = editor.value.substring(lineEnd);

    // Keep list marker outside, wrap only the content
    const rejectStart = `<!-- reject-start: ${stub} -->`;
    const newLine = listParts.marker + rejectStart + listParts.content + '<!-- reject-end -->';
    editor.value = before + newLine + after;

    // Position cursor inside the stub text
    const stubStart = before.length + listParts.marker.length + '<!-- reject-start: '.length;
    editor.selectionStart = stubStart;
    editor.selectionEnd = stubStart + stub.length;
    editor.focus();

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section rejection (under a heading)
  const cursorPos = start;
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

  // Check if next line is a status marker and remove it (handles rejected with reason too)
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected)/)) {
      lines.splice(targetLineIndex, 1);
      editor.value = lines.join('\n');
    }
  }

  // Insert rejected status with stub reason
  const before = editor.value.substring(0, insertPos);
  const after = editor.value.substring(insertPos);
  const marker = `<!-- status: rejected: ${stub} -->\n`;

  editor.value = before + marker + after;

  // Position cursor inside the stub text for easy editing
  const stubStart = before.length + '<!-- status: rejected: '.length;
  editor.selectionStart = stubStart;
  editor.selectionEnd = stubStart + stub.length;
  editor.focus();

  renderPreview();
  scheduleSave();
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
