import APIClient from './api-client.js';
import { EditorView } from 'https://esm.sh/@codemirror/view@6';
import { EditorState } from 'https://esm.sh/@codemirror/state@6';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown@6.3.1';
import { history, historyKeymap, undo, redo } from 'https://esm.sh/@codemirror/commands@6';
import { lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from 'https://esm.sh/@codemirror/view@6';
import { foldGutter, indentOnInput, bracketMatching, foldKeymap } from 'https://esm.sh/@codemirror/language@6';
import { defaultKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { searchKeymap, highlightSelectionMatches } from 'https://esm.sh/@codemirror/search@6';
import { autocompletion, completionKeymap } from 'https://esm.sh/@codemirror/autocomplete@6';
import { keymap } from 'https://esm.sh/@codemirror/view@6';
import { initTheme, toggleTheme, getTheme, onThemeChange, getEditorTheme } from './theme.js?v=4';

// Custom editor setup without default syntax highlighting (we use our own theme)
const customSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    indentWithTab
  ])
];

const api = new APIClient();

// DOM elements
const editorContainer = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewPane = document.getElementById('preview-pane');
const title = document.getElementById('title');
const backButton = document.getElementById('back-button');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const addCommentBtn = document.getElementById('add-comment');
const proposeSectionBtn = document.getElementById('propose-section');
const approveSectionBtn = document.getElementById('approve-section');
const rejectSectionBtn = document.getElementById('reject-section');
const clearStatusBtn = document.getElementById('clear-status');
const refreshPreviewBtn = document.getElementById('refresh-preview');
const exportSelect = document.getElementById('export-select');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const resizer = document.getElementById('resizer');
const tooltip = document.getElementById('tooltip');
const themeToggleBtn = document.getElementById('theme-toggle');
const minimapContent = document.getElementById('minimap-content');
const minimapViewport = document.getElementById('minimap-viewport');
const minimapTrack = document.getElementById('minimap-track');

// State
let documentId = null;
let saveTimeout = null;
let refreshTimeout = null;
let isUpdatingFromServer = false;
let isSyncing = false;
let editorView = null;
let lastSavedContent = ''; // Track what we last saved to ignore our own WebSocket echoes

// Find line number in source for given text
function findLineForText(text) {
  if (!editorView || !text) return -1;

  const content = getEditorContent();
  const lines = content.split('\n');

  // Clean the text for matching (remove markdown formatting artifacts)
  const cleanText = text.trim()
    .replace(/\s+/g, ' ')
    .substring(0, 100); // Use first 100 chars for matching

  if (!cleanText) return -1;

  // Search for the text in each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line contains the search text (case-insensitive, partial match)
    if (line.toLowerCase().includes(cleanText.toLowerCase().substring(0, 30))) {
      return i;
    }
  }

  // Fallback: search in content as a whole
  const pos = content.toLowerCase().indexOf(cleanText.toLowerCase().substring(0, 30));
  if (pos !== -1) {
    // Count newlines before this position
    const beforePos = content.substring(0, pos);
    return (beforePos.match(/\n/g) || []).length;
  }

  return -1;
}

// Jump to line in editor with highlight flash
function jumpToLine(lineNumber) {
  if (!editorView || lineNumber < 0) return;

  const doc = editorView.state.doc;
  if (lineNumber >= doc.lines) return;

  const line = doc.line(lineNumber + 1); // CodeMirror lines are 1-indexed

  // Set cursor to start of line and scroll into view
  editorView.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true
  });

  editorView.focus();

  // Flash highlight the active line
  requestAnimationFrame(() => {
    const activeLine = editorView.dom.querySelector('.cm-activeLine');
    if (activeLine) {
      activeLine.classList.add('flash-highlight');
      setTimeout(() => {
        activeLine.classList.remove('flash-highlight');
      }, 3000);
    }
  });
}

// Get direct text content of an element (excluding nested block elements)
function getDirectTextContent(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Include inline elements but skip block elements like nested lists
      const tag = node.tagName;
      if (!['UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE'].includes(tag)) {
        text += node.textContent;
      }
    }
  }
  return text.trim();
}

// Set up click-to-source on preview elements
function setupClickToSource() {
  preview.addEventListener('click', (e) => {
    // Find the closest block-level element
    const blockElements = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH'];
    let target = e.target;

    // Walk up to find a block element
    while (target && target !== preview) {
      if (blockElements.includes(target.tagName)) {
        break;
      }
      target = target.parentElement;
    }

    if (!target || target === preview) return;

    // Get direct text content (excluding nested lists/blocks)
    const text = getDirectTextContent(target);

    // Find and jump to the line
    const lineNumber = findLineForText(text);
    if (lineNumber >= 0) {
      jumpToLine(lineNumber);
    }
  });
}

// Get document ID from URL
const params = new URLSearchParams(window.location.search);
documentId = params.get('id');

if (!documentId) {
  window.location.href = '/';
}

// Initialize CodeMirror editor
function initCodeEditor(initialContent = '') {
  editorView = new EditorView({
    doc: initialContent,
    extensions: [
      ...customSetup,
      markdown(),
      ...getEditorTheme(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          scheduleSave();
          scheduleAutoRefresh();
        }
      }),
    ],
    parent: editorContainer,
  });
}

// Recreate editor with new theme
function recreateEditorWithTheme() {
  if (!editorView) return;

  const content = editorView.state.doc.toString();
  const sel = getSelection();

  // Destroy old editor
  editorView.destroy();

  // Create new editor with updated theme
  editorView = new EditorView({
    doc: content,
    extensions: [
      ...customSetup,
      markdown(),
      ...getEditorTheme(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          scheduleSave();
          scheduleAutoRefresh();
        }
      }),
    ],
    parent: editorContainer,
  });

  // Restore cursor position
  setCursor(Math.min(sel.from, content.length));
}

// Helper to get current editor content
function getEditorContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

// Helper to set editor content
function setEditorContent(content) {
  if (editorView) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content }
    });
  }
}

// Helper to get selection range
function getSelection() {
  if (!editorView) return { from: 0, to: 0 };
  const sel = editorView.state.selection.main;
  return { from: sel.from, to: sel.to };
}

// Helper to set cursor position
function setCursor(pos) {
  if (editorView) {
    editorView.dispatch({
      selection: { anchor: pos }
    });
    editorView.focus();
  }
}

// Helper to set selection range
function setSelection(from, to) {
  if (editorView) {
    editorView.dispatch({
      selection: { anchor: from, head: to }
    });
    editorView.focus();
  }
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
  initCodeEditor(doc.content);
  renderPreview();
}

// Render markdown preview with custom processing
function renderPreview() {
  let content = getEditorContent();

  // Process comment markers BEFORE markdown (they need special handling)
  content = processCommentMarkers(content);

  // Render markdown first
  let html = marked.parse(content);

  // Process status markers AFTER markdown (they wrap rendered content)
  html = processStatusMarkersInHtml(html);

  preview.innerHTML = html;

  // Add tooltip handlers for inline comments
  setupTooltips();

  // Update minimap after content is rendered
  requestAnimationFrame(() => updateMinimap());
}

// Update the minimap with markers for highlighted content
function updateMinimap() {
  if (!minimapContent || !preview) return;

  // Clear existing markers
  minimapContent.innerHTML = '';

  const previewHeight = preview.scrollHeight;
  const minimapHeight = minimapContent.parentElement.clientHeight;

  if (previewHeight === 0) return;

  // Find all highlighted elements
  const selectors = [
    { selector: '.section-proposed, .propose-inline', type: 'proposed' },
    { selector: '.section-approved, .approve-inline', type: 'approved' },
    { selector: '.section-rejected, .reject-inline', type: 'rejected' },
    { selector: '.comment-block, .comment-inline', type: 'comment' },
  ];

  selectors.forEach(({ selector, type }) => {
    const elements = preview.querySelectorAll(selector);
    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();

      // Calculate position relative to preview content
      const offsetTop = el.offsetTop;
      const height = el.offsetHeight;

      // Scale to minimap
      const top = (offsetTop / previewHeight) * minimapHeight;
      const markerHeight = Math.max(3, (height / previewHeight) * minimapHeight);

      const marker = document.createElement('div');
      marker.className = `minimap-marker ${type}`;
      marker.style.top = `${top}px`;
      marker.style.height = `${markerHeight}px`;
      marker.dataset.scrollTarget = offsetTop;
      marker.title = type.charAt(0).toUpperCase() + type.slice(1);

      minimapContent.appendChild(marker);
    });
  });

  // Update viewport indicator
  updateMinimapViewport();
}

// Update the viewport indicator position
function updateMinimapViewport() {
  if (!minimapViewport || !previewPane) return;

  const previewHeight = preview.scrollHeight;
  const viewportHeight = previewPane.clientHeight;
  const minimapHeight = minimapViewport.parentElement.clientHeight;
  const scrollTop = previewPane.scrollTop;

  if (previewHeight === 0) return;

  // Calculate viewport indicator size and position
  const viewportRatio = viewportHeight / previewHeight;
  const indicatorHeight = Math.max(20, viewportRatio * minimapHeight);
  const indicatorTop = (scrollTop / previewHeight) * minimapHeight;

  minimapViewport.style.height = `${indicatorHeight}px`;
  minimapViewport.style.top = `${indicatorTop}px`;
}

// Process <!-- status: approved/rejected/proposed --> markers in rendered HTML
function processStatusMarkersInHtml(html) {
  // Process section-level status markers
  // These appear after headings and affect all content until the next heading

  // Find all status markers and wrap content until next heading
  const approvedRegex = /<!--\s*status:\s*approved\s*-->/g;
  const rejectedRegex = /<!--\s*status:\s*rejected(?::\s*([\s\S]*?))?\s*-->/g;
  const proposedRegex = /<!--\s*status:\s*proposed(?::\s*([\s\S]*?))?\s*-->/g;

  // Replace approved markers - wrap following content until next heading or end
  html = html.replace(approvedRegex, '<div class="section-status section-approved">');

  // Replace rejected markers with reason
  html = html.replace(rejectedRegex, (match, reason) => {
    if (reason && reason.trim()) {
      return `<div class="section-status section-rejected"><div class="rejection-reason">Rejected: ${reason.trim()}</div>`;
    }
    return '<div class="section-status section-rejected">';
  });

  // Replace proposed markers with optional label
  html = html.replace(proposedRegex, (match, label) => {
    if (label && label.trim()) {
      return `<div class="section-status section-proposed"><div class="proposed-label">Proposed: ${label.trim()}</div>`;
    }
    return '<div class="section-status section-proposed"><div class="proposed-label">Proposed</div>';
  });

  // Close any open section-status divs before headings
  html = html.replace(/(<div class="section-status[^>]*>)([\s\S]*?)(<h[1-6])/g, '$1$2</div>$3');

  // Close any unclosed section-status divs at the end
  const openCount = (html.match(/<div class="section-status/g) || []).length;
  const closeCount = (html.match(/<\/div>[\s\S]*?(?=<div class="section-status|$)/g) || []).length;

  // Simple approach: add closing divs for any unclosed section-status
  let tempHtml = html;
  let opens = 0;
  let closes = 0;

  // Count opens
  const openMatches = html.match(/<div class="section-status[^>]*>/g);
  if (openMatches) opens = openMatches.length;

  // For each open, find if there's a close before the next heading or end
  // Simpler: just ensure we close at the end if needed
  const lastOpenIndex = html.lastIndexOf('<div class="section-status');
  if (lastOpenIndex !== -1) {
    const afterLastOpen = html.substring(lastOpenIndex);
    const hasClose = afterLastOpen.includes('</div>');
    if (!hasClose) {
      html += '</div>';
    }
  }

  return html;
}

// Helper to escape HTML entities
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Process comment markers
function processCommentMarkers(content) {
  // Standalone comments (supports multi-line): <!-- comment: text -->
  // Use [\s\S]*? to match any character including newlines (non-greedy)
  content = content.replace(
    /<!--\s*comment:\s*([\s\S]*?)-->/g,
    (match, commentText) => {
      const trimmed = commentText.trim();
      // Check if it's a multi-line comment (contains newlines)
      if (trimmed.includes('\n')) {
        // Render as preformatted block with escaped HTML
        return `<div class="comment-block"><pre>${escapeHtml(trimmed)}</pre></div>`;
      }
      // Single line comment
      return `<div class="comment-block">${escapeHtml(trimmed)}</div>`;
    }
  );

  // Inline comments: <!-- comment-start: text -->...<!-- comment-end -->
  content = content.replace(
    /<!--\s*comment-start:\s*([\s\S]*?)-->([\s\S]*?)<!--\s*comment-end\s*-->/g,
    '<span class="comment-inline"><span class="comment-inline-text">Comment: $1</span>$2</span>'
  );

  // Inline rejections: <!-- reject-start: reason -->...<!-- reject-end -->
  content = content.replace(
    /<!--\s*reject-start:\s*([\s\S]*?)-->([\s\S]*?)<!--\s*reject-end\s*-->/g,
    '<span class="reject-inline"><span class="reject-inline-reason">Rejected: $1</span>$2</span>'
  );

  // Inline approvals: <!-- approve-start -->...<!-- approve-end -->
  content = content.replace(
    /<!--\s*approve-start\s*-->([\s\S]*?)<!--\s*approve-end\s*-->/g,
    '<span class="approve-inline">$1</span>'
  );

  // Inline proposals: <!-- propose-start -->...<!-- propose-end --> or <!-- propose-start: label -->...<!-- propose-end -->
  content = content.replace(
    /<!--\s*propose-start(?::\s*([\s\S]*?))?\s*-->([\s\S]*?)<!--\s*propose-end\s*-->/g,
    (match, label, text) => {
      if (label && label.trim()) {
        return `<span class="propose-inline"><span class="propose-inline-label">Proposed: ${label.trim()}</span>${text}</span>`;
      }
      return `<span class="propose-inline"><span class="propose-inline-label">Proposed</span>${text}</span>`;
    }
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

    // Track what we're saving so we can ignore our own WebSocket echo
    lastSavedContent = getEditorContent();
    await api.updateDocument(documentId, lastSavedContent);
  }, 500);
}

// Auto-refresh preview with debounce (2 second pause)
function scheduleAutoRefresh() {
  if (refreshTimeout) clearTimeout(refreshTimeout);

  refreshTimeout = setTimeout(() => {
    renderPreview();
  }, 2000);
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
  const content = getEditorContent();
  const before = content.substring(0, pos);
  const after = content.substring(pos);
  setEditorContent(before + text + after);
  renderPreview();
  scheduleSave();
}

// Add comment button handler
addCommentBtn.addEventListener('click', () => {
  const sel = getSelection();
  const content = getEditorContent();

  if (sel.from !== sel.to) {
    // Wrap selection with inline comment - insert stub for user to edit
    const before = content.substring(0, sel.from);
    const selected = content.substring(sel.from, sel.to);
    const after = content.substring(sel.to);

    const stub = 'your comment here';
    const commentStart = `<!-- comment-start: ${stub} -->`;
    setEditorContent(before + commentStart + selected + '<!-- comment-end -->' + after);

    // Position cursor inside the stub text for easy editing
    const stubStart = before.length + '<!-- comment-start: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
  } else {
    // Insert standalone comment at cursor - insert stub for user to edit
    const before = content.substring(0, sel.from);
    const after = content.substring(sel.from);

    const stub = 'your comment here';
    const comment = `\n<!-- comment: ${stub} -->\n`;
    setEditorContent(before + comment + after);

    // Position cursor inside the stub text for easy editing
    const stubStart = before.length + '\n<!-- comment: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
  }
});

// Propose section button handler
proposeSectionBtn.addEventListener('click', () => {
  const sel = getSelection();
  const stub = 'label here';
  let content = getEditorContent();

  // Case 1: Text is selected - use inline propose
  if (sel.from !== sel.to) {
    const before = content.substring(0, sel.from);
    const selected = content.substring(sel.from, sel.to);
    const after = content.substring(sel.to);

    // Check if selection is already proposed - do nothing
    if (selected.match(/<!-- propose-start/) || before.match(/<!-- propose-start[^>]*-->$/)) {
      return;
    }

    // Check if selection contains approval markers - switch to proposed
    if (selected.includes('<!-- approve-start -->')) {
      const cleaned = selected
        .replace(/<!-- approve-start -->/g, `<!-- propose-start: ${stub} -->`)
        .replace(/<!-- approve-end -->/g, '<!-- propose-end -->');
      setEditorContent(before + cleaned + after);
      const stubStart = before.length + '<!-- propose-start: '.length;
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if selection contains rejection markers - switch to proposed
    if (selected.match(/<!-- reject-start:[\s\S]*?-->/)) {
      const cleaned = selected
        .replace(/<!-- reject-start:[\s\S]*?-->/g, `<!-- propose-start: ${stub} -->`)
        .replace(/<!-- reject-end -->/g, '<!-- propose-end -->');
      setEditorContent(before + cleaned + after);
      const stubStart = before.length + '<!-- propose-start: '.length;
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside approval markers on current line
    const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
    if (lineContent.includes('<!-- approve-start -->')) {
      const newLine = lineContent
        .replace(/<!-- approve-start -->/g, `<!-- propose-start: ${stub} -->`)
        .replace(/<!-- approve-end -->/g, '<!-- propose-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      const stubStart = lineStart + newLine.indexOf(stub);
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside rejection markers on current line
    if (lineContent.match(/<!-- reject-start:/)) {
      const newLine = lineContent
        .replace(/<!-- reject-start:[\s\S]*?-->/g, `<!-- propose-start: ${stub} -->`)
        .replace(/<!-- reject-end -->/g, '<!-- propose-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      const stubStart = lineStart + newLine.indexOf(stub);
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    const proposeStart = `<!-- propose-start: ${stub} -->`;
    setEditorContent(before + proposeStart + selected + '<!-- propose-end -->' + after);

    // Position cursor inside the stub text
    const stubStart = before.length + '<!-- propose-start: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 2: Cursor is on a list item - wrap content after list marker
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
  const listParts = parseListItem(lineContent);
  if (listParts) {
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);

    // Keep list marker outside, wrap only the content
    const proposeStart = `<!-- propose-start: ${stub} -->`;
    const newLine = listParts.marker + proposeStart + listParts.content + '<!-- propose-end -->';
    setEditorContent(before + newLine + after);

    // Position cursor inside the stub text
    const stubStart = before.length + listParts.marker.length + '<!-- propose-start: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section propose (under a heading)
  const cursorPos = sel.from;
  const insertPos = findNearestHeading(content, cursorPos);

  // Remove any existing status marker for this section first
  const lines = content.split('\n');
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
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected|proposed)/)) {
      lines.splice(targetLineIndex, 1);
      setEditorContent(lines.join('\n'));
      content = getEditorContent(); // refresh content after modification
    }
  }

  // Insert proposed status with stub label
  const before = content.substring(0, insertPos);
  const after = content.substring(insertPos);
  const marker = `<!-- status: proposed: ${stub} -->\n`;

  setEditorContent(before + marker + after);

  // Position cursor inside the stub text for easy editing
  const stubStart = before.length + '<!-- status: proposed: '.length;
  setSelection(stubStart, stubStart + stub.length);

  renderPreview();
  scheduleSave();
});

// Approve section button handler
approveSectionBtn.addEventListener('click', () => {
  const sel = getSelection();
  let content = getEditorContent();

  // Case 1: Text is selected - use inline approval (or toggle from rejection)
  if (sel.from !== sel.to) {
    const before = content.substring(0, sel.from);
    const selected = content.substring(sel.from, sel.to);
    const after = content.substring(sel.to);

    // Check if selection is already approved - do nothing
    if (selected.includes('<!-- approve-start -->') || before.endsWith('<!-- approve-start -->')) {
      return;
    }

    // Check if selection contains rejection markers - switch to approval
    if (selected.match(/<!-- reject-start:[\s\S]*?-->/)) {
      const cleaned = selected
        .replace(/<!-- reject-start:[\s\S]*?-->/g, '<!-- approve-start -->')
        .replace(/<!-- reject-end -->/g, '<!-- approve-end -->');
      setEditorContent(before + cleaned + after);
      setCursor(sel.from);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if selection contains proposed markers - switch to approval
    if (selected.match(/<!-- propose-start[\s\S]*?-->/)) {
      const cleaned = selected
        .replace(/<!-- propose-start[\s\S]*?-->/g, '<!-- approve-start -->')
        .replace(/<!-- propose-end -->/g, '<!-- approve-end -->');
      setEditorContent(before + cleaned + after);
      setCursor(sel.from);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside rejection markers on current line
    const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
    if (lineContent.match(/<!-- reject-start:/)) {
      const newLine = lineContent
        .replace(/<!-- reject-start:[\s\S]*?-->/g, '<!-- approve-start -->')
        .replace(/<!-- reject-end -->/g, '<!-- approve-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      setCursor(sel.from);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside proposed markers on current line
    if (lineContent.match(/<!-- propose-start/)) {
      const newLine = lineContent
        .replace(/<!-- propose-start[\s\S]*?-->/g, '<!-- approve-start -->')
        .replace(/<!-- propose-end -->/g, '<!-- approve-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      setCursor(sel.from);
      renderPreview();
      scheduleSave();
      return;
    }

    setEditorContent(before + '<!-- approve-start -->' + selected + '<!-- approve-end -->' + after);
    setCursor(sel.from);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 2: Cursor is on a list item - wrap content after list marker
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
  const listParts = parseListItem(lineContent);
  if (listParts) {
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);

    // Keep list marker outside, wrap only the content
    const newLine = listParts.marker + '<!-- approve-start -->' + listParts.content + '<!-- approve-end -->';
    setEditorContent(before + newLine + after);
    setCursor(lineStart);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section approval (under a heading)
  const cursorPos = sel.from;
  const insertPos = findNearestHeading(content, cursorPos);

  // Remove any existing status marker for this section first
  const lines = content.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it (handles rejected/proposed with reason too)
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected|proposed)/)) {
      lines.splice(targetLineIndex, 1);
      setEditorContent(lines.join('\n'));
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
  const sel = getSelection();
  const stub = 'your reason here';
  let content = getEditorContent();

  // Case 1: Text is selected - use inline rejection (or toggle from approval)
  if (sel.from !== sel.to) {
    const before = content.substring(0, sel.from);
    const selected = content.substring(sel.from, sel.to);
    const after = content.substring(sel.to);

    // Check if selection is already rejected - do nothing
    if (selected.match(/<!-- reject-start:/) || before.match(/<!-- reject-start:[^>]*-->$/)) {
      return;
    }

    // Check if selection contains approval markers - switch to rejection
    if (selected.includes('<!-- approve-start -->')) {
      const cleaned = selected
        .replace(/<!-- approve-start -->/g, `<!-- reject-start: ${stub} -->`)
        .replace(/<!-- approve-end -->/g, '<!-- reject-end -->');
      setEditorContent(before + cleaned + after);
      // Position cursor at the stub
      const stubStart = before.length + '<!-- reject-start: '.length;
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if selection contains proposed markers - switch to rejection
    if (selected.match(/<!-- propose-start[\s\S]*?-->/)) {
      const cleaned = selected
        .replace(/<!-- propose-start[\s\S]*?-->/g, `<!-- reject-start: ${stub} -->`)
        .replace(/<!-- propose-end -->/g, '<!-- reject-end -->');
      setEditorContent(before + cleaned + after);
      // Position cursor at the stub
      const stubStart = before.length + '<!-- reject-start: '.length;
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside approval markers on current line
    const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
    if (lineContent.includes('<!-- approve-start -->')) {
      const newLine = lineContent
        .replace(/<!-- approve-start -->/g, `<!-- reject-start: ${stub} -->`)
        .replace(/<!-- approve-end -->/g, '<!-- reject-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      const stubStart = lineStart + newLine.indexOf(stub);
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    // Check if cursor is inside proposed markers on current line
    if (lineContent.match(/<!-- propose-start/)) {
      const newLine = lineContent
        .replace(/<!-- propose-start[\s\S]*?-->/g, `<!-- reject-start: ${stub} -->`)
        .replace(/<!-- propose-end -->/g, '<!-- reject-end -->');
      setEditorContent(content.substring(0, lineStart) + newLine + content.substring(lineEnd));
      const stubStart = lineStart + newLine.indexOf(stub);
      setSelection(stubStart, stubStart + stub.length);
      renderPreview();
      scheduleSave();
      return;
    }

    const rejectStart = `<!-- reject-start: ${stub} -->`;
    setEditorContent(before + rejectStart + selected + '<!-- reject-end -->' + after);

    // Position cursor inside the stub text
    const stubStart = before.length + '<!-- reject-start: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 2: Cursor is on a list item - wrap content after list marker
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);
  const listParts = parseListItem(lineContent);
  if (listParts) {
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);

    // Keep list marker outside, wrap only the content
    const rejectStart = `<!-- reject-start: ${stub} -->`;
    const newLine = listParts.marker + rejectStart + listParts.content + '<!-- reject-end -->';
    setEditorContent(before + newLine + after);

    // Position cursor inside the stub text
    const stubStart = before.length + listParts.marker.length + '<!-- reject-start: '.length;
    setSelection(stubStart, stubStart + stub.length);

    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section rejection (under a heading)
  const cursorPos = sel.from;
  const insertPos = findNearestHeading(content, cursorPos);

  // Remove any existing status marker for this section first
  const lines = content.split('\n');
  let linePos = 0;
  let targetLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (linePos >= insertPos) {
      targetLineIndex = i;
      break;
    }
    linePos += lines[i].length + 1;
  }

  // Check if next line is a status marker and remove it (handles rejected/proposed with reason too)
  if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected|proposed)/)) {
      lines.splice(targetLineIndex, 1);
      setEditorContent(lines.join('\n'));
      content = getEditorContent(); // refresh content after modification
    }
  }

  // Insert rejected status with stub reason
  const before = content.substring(0, insertPos);
  const after = content.substring(insertPos);
  const marker = `<!-- status: rejected: ${stub} -->\n`;

  setEditorContent(before + marker + after);

  // Position cursor inside the stub text for easy editing
  const stubStart = before.length + '<!-- status: rejected: '.length;
  setSelection(stubStart, stubStart + stub.length);

  renderPreview();
  scheduleSave();
});

// Clear status button handler - removes approval/rejection/proposed markers
clearStatusBtn.addEventListener('click', () => {
  const sel = getSelection();
  let content = getEditorContent();

  // Case 1: Text is selected - check if it contains inline markers and remove them
  if (sel.from !== sel.to) {
    const before = content.substring(0, sel.from);
    const selected = content.substring(sel.from, sel.to);
    const after = content.substring(sel.to);

    // Check for and remove inline markers within or around selection
    let newContent = content;

    // Check if selection is inside approve/reject/propose markers
    const approveMatch = content.match(new RegExp(`<!-- approve-start -->[\\s\\S]*?${escapeRegex(selected)}[\\s\\S]*?<!-- approve-end -->`));
    const rejectMatch = content.match(new RegExp(`<!-- reject-start:[\\s\\S]*?-->[\\s\\S]*?${escapeRegex(selected)}[\\s\\S]*?<!-- reject-end -->`));
    const proposeMatch = content.match(new RegExp(`<!-- propose-start[\\s\\S]*?-->[\\s\\S]*?${escapeRegex(selected)}[\\s\\S]*?<!-- propose-end -->`));

    if (approveMatch) {
      newContent = content.replace(/<!-- approve-start -->([\s\S]*?)<!-- approve-end -->/, '$1');
    } else if (rejectMatch) {
      newContent = content.replace(/<!-- reject-start:[\s\S]*?-->([\s\S]*?)<!-- reject-end -->/, '$1');
    } else if (proposeMatch) {
      newContent = content.replace(/<!-- propose-start[\s\S]*?-->([\s\S]*?)<!-- propose-end -->/, '$1');
    }

    if (newContent !== content) {
      setEditorContent(newContent);
      renderPreview();
      scheduleSave();
      return;
    }
  }

  // Case 2: Cursor on a line - check if line has inline markers
  const { lineStart, lineEnd, lineContent } = getCurrentLineInfo(content, sel.from);

  // Check for inline markers on current line
  if (lineContent.includes('<!-- approve-start -->')) {
    const newLine = lineContent
      .replace(/<!-- approve-start -->/g, '')
      .replace(/<!-- approve-end -->/g, '');
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);
    setEditorContent(before + newLine + after);
    renderPreview();
    scheduleSave();
    return;
  }

  if (lineContent.match(/<!-- reject-start:/)) {
    const newLine = lineContent
      .replace(/<!-- reject-start:[\s\S]*?-->/g, '')
      .replace(/<!-- reject-end -->/g, '');
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);
    setEditorContent(before + newLine + after);
    renderPreview();
    scheduleSave();
    return;
  }

  if (lineContent.match(/<!-- propose-start/)) {
    const newLine = lineContent
      .replace(/<!-- propose-start[\s\S]*?-->/g, '')
      .replace(/<!-- propose-end -->/g, '');
    const before = content.substring(0, lineStart);
    const after = content.substring(lineEnd);
    setEditorContent(before + newLine + after);
    renderPreview();
    scheduleSave();
    return;
  }

  // Case 3: Section status - find and remove status marker for current section
  const cursorPos = sel.from;
  const insertPos = findNearestHeading(content, cursorPos);

  const lines = content.split('\n');
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
    if (lines[targetLineIndex].match(/<!--\s*status:\s*(approved|rejected|proposed)/)) {
      lines.splice(targetLineIndex, 1);
      setEditorContent(lines.join('\n'));
      renderPreview();
      scheduleSave();
    }
  }
});

// Helper to escape special regex characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    content = getEditorContent();
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

// Undo/Redo buttons
undoBtn.addEventListener('click', () => {
  if (editorView) {
    undo(editorView);
    renderPreview();
    scheduleSave();
  }
});

redoBtn.addEventListener('click', () => {
  if (editorView) {
    redo(editorView);
    renderPreview();
    scheduleSave();
  }
});

// Update undo/redo button states based on editor history
function updateUndoRedoButtons() {
  if (!editorView) {
    undoBtn.disabled = true;
    redoBtn.disabled = true;
    return;
  }
  // Check if there's history to undo/redo
  const state = editorView.state;
  // CodeMirror doesn't expose history depth directly, so we enable based on doc changes
  undoBtn.disabled = false; // Will be disabled by command if nothing to undo
  redoBtn.disabled = false; // Will be disabled by command if nothing to redo
}

// Refresh preview button
refreshPreviewBtn.addEventListener('click', () => renderPreview());

// Keyboard shortcut: Ctrl+Enter to refresh preview
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    renderPreview();
  }
});

// Synchronized scrolling
let editorScrolling = false;
let previewScrolling = false;

// Setup synchronized scrolling after editor is initialized
function setupSyncScroll() {
  // Get the CodeMirror scroll element
  const cmScroller = editorContainer.querySelector('.cm-scroller');
  if (!cmScroller) return;

  cmScroller.addEventListener('scroll', () => {
    if (previewScrolling) return;
    editorScrolling = true;

    const percentage = cmScroller.scrollTop / (cmScroller.scrollHeight - cmScroller.clientHeight);
    previewPane.scrollTop = percentage * (previewPane.scrollHeight - previewPane.clientHeight);

    setTimeout(() => { editorScrolling = false; }, 50);
  });

  previewPane.addEventListener('scroll', () => {
    if (editorScrolling) return;
    previewScrolling = true;

    const percentage = previewPane.scrollTop / (previewPane.scrollHeight - previewPane.clientHeight);
    cmScroller.scrollTop = percentage * (cmScroller.scrollHeight - cmScroller.clientHeight);

    // Update minimap viewport indicator
    updateMinimapViewport();

    setTimeout(() => { previewScrolling = false; }, 50);
  });
}

// Setup minimap click handlers
function setupMinimap() {
  if (!minimapTrack || !minimapContent) return;

  // Click on track to jump to position
  minimapTrack.addEventListener('click', (e) => {
    const rect = minimapTrack.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const percentage = clickY / rect.height;
    const scrollTarget = percentage * preview.scrollHeight;

    previewPane.scrollTo({
      top: scrollTarget - previewPane.clientHeight / 2,
      behavior: 'smooth'
    });
  });

  // Click on markers to jump to that element
  minimapContent.addEventListener('click', (e) => {
    if (e.target.classList.contains('minimap-marker')) {
      const scrollTarget = parseFloat(e.target.dataset.scrollTarget);
      previewPane.scrollTo({
        top: scrollTarget - 50,
        behavior: 'smooth'
      });
    }
  });

  // Update minimap on window resize
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      updateMinimap();
    });
  });
}

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
    // Ignore our own WebSocket echo (content matches what we just saved)
    if (message.content === lastSavedContent) {
      return;
    }

    // External update - only update if content differs from what's in editor
    if (message.content !== getEditorContent()) {
      isUpdatingFromServer = true;
      const sel = getSelection();

      lastSavedContent = message.content; // Update so we don't echo back
      setEditorContent(message.content);
      renderPreview();

      // Restore cursor position
      setCursor(Math.min(sel.from, message.content.length));

      // Show brief notification
      const notification = document.createElement('div');
      notification.textContent = '✓ Document updated';
      notification.style.cssText = 'position: fixed; top: 60px; right: 20px; background: #4caf50; color: white; padding: 12px 20px; border-radius: 4px; z-index: 1000;';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);

      setTimeout(() => { isUpdatingFromServer = false; }, 100);
    }
  }

  if (message.type === 'document_deleted' && message.id === documentId) {
    alert('This document has been deleted');
    window.location.href = '/';
  }
});

// Theme toggle
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    toggleTheme();
    recreateEditorWithTheme();
  });
}

// Subscribe to theme changes from other sources
onThemeChange(() => {
  recreateEditorWithTheme();
});

// Initialize
initTheme();
api.connectWebSocket();
api.subscribe(documentId);
loadDocument().then(() => {
  setupSyncScroll();
  setupClickToSource();
  setupMinimap();
  updateUndoRedoButtons();
});
