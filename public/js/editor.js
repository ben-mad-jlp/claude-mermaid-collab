import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
import * as wireframe from './plugins/mermaid-wireframe.js';
import APIClient from './api-client.js';
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { mermaidLanguage } from './cm-lang-mermaid.js';
import { wireframeLanguage } from './cm-lang-wireframe.js';
import { initTheme, toggleTheme, getTheme, onThemeChange, getEditorTheme } from './theme.js';

// Register wireframe plugin
await mermaid.registerExternalDiagrams([wireframe]);

const api = new APIClient();

// Get diagram ID from URL
const params = new URLSearchParams(window.location.search);
const diagramId = params.get('id');

if (!diagramId) {
  alert('No diagram ID specified');
  window.location.href = '/';
}

// DOM elements
const title = document.getElementById('title');
const editorContainer = document.getElementById('editor');
const preview = document.getElementById('preview');
const errorBanner = document.getElementById('error');
const resizer = document.getElementById('resizer');
const editorPane = document.querySelector('.editor-pane');
const splitPane = document.querySelector('.split-pane');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const exportSvgBtn = document.getElementById('export-svg');
const exportPngBtn = document.getElementById('export-png');
const copyCodeBtn = document.getElementById('copy-code');
const backButton = document.getElementById('back-button');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const zoomFitBtn = document.getElementById('zoom-fit');
const zoomFitWidthBtn = document.getElementById('zoom-fit-width');
const zoomFitHeightBtn = document.getElementById('zoom-fit-height');
const zoomLevel = document.getElementById('zoom-level');
const toggleDirectionBtn = document.getElementById('toggle-direction');
const refreshPreviewBtn = document.getElementById('refresh-preview');
const syntaxHelpBtn = document.getElementById('syntax-help');
const syntaxModal = document.getElementById('syntax-modal');
const syntaxModalTitle = document.getElementById('syntax-modal-title');
const syntaxModalBody = document.getElementById('syntax-modal-body');
const syntaxModalClose = document.getElementById('syntax-modal-close');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const themeToggleBtn = document.getElementById('theme-toggle');

// State
let currentContent = '';
let currentTheme = 'default';
let saveTimeout = null;
let refreshTimeout = null;
let undoStack = [];
let redoStack = [];
let panzoomInstance = null;
let currentScale = 1;
let wheelHandler = null;
let editorView = null;
let lastSavedContent = ''; // Track what we last saved to ignore our own WebSocket echoes

// Detect diagram type from content
function detectDiagramType(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith('wireframe')) {
    return 'wireframe';
  }
  return 'mermaid';
}

// Initialize CodeMirror editor
function initCodeEditor(initialContent = '') {
  const diagramType = detectDiagramType(initialContent);
  const languageExtension = diagramType === 'wireframe' ? wireframeLanguage : mermaidLanguage;

  editorView = new EditorView({
    doc: initialContent,
    extensions: [
      basicSetup,
      languageExtension,
      ...getEditorTheme(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const code = update.state.doc.toString();
          if (code !== currentContent) {
            pushUndo(currentContent);
            currentContent = code;
            scheduleAutoSave();
            scheduleAutoRefresh();
          }
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
  const sel = editorView.state.selection.main;
  const diagramType = detectDiagramType(content);
  const languageExtension = diagramType === 'wireframe' ? wireframeLanguage : mermaidLanguage;

  // Destroy old editor
  editorView.destroy();

  // Create new editor with updated theme
  editorView = new EditorView({
    doc: content,
    extensions: [
      basicSetup,
      languageExtension,
      ...getEditorTheme(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const code = update.state.doc.toString();
          if (code !== currentContent) {
            pushUndo(currentContent);
            currentContent = code;
            scheduleAutoSave();
            scheduleAutoRefresh();
          }
        }
      }),
    ],
    parent: editorContainer,
  });

  // Restore cursor position
  editorView.dispatch({
    selection: { anchor: Math.min(sel.anchor, content.length), head: Math.min(sel.head, content.length) }
  });
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

// Load diagram
async function loadDiagram() {
  const diagram = await api.getDiagram(diagramId);
  title.textContent = diagram.name;
  currentContent = diagram.content;
  initCodeEditor(currentContent);
  undoStack = [currentContent];
  renderPreview();
}

// Render preview
async function renderPreview(preserveZoom = true) {
  try {
    // Save current zoom/pan state before destroying
    let savedScale = currentScale;
    let savedPan = { x: 0, y: 0 };
    const isFirstRender = !panzoomInstance;

    if (panzoomInstance) {
      savedPan = panzoomInstance.getPan();
    }

    // Cleanup old panzoom instance and wheel handler BEFORE replacing content
    if (panzoomInstance) {
      panzoomInstance.destroy();
      panzoomInstance = null;
    }

    // Remove old wheel event listener
    if (wheelHandler) {
      preview.removeEventListener('wheel', wheelHandler);
      wheelHandler = null;
    }

    mermaid.initialize({
      theme: currentTheme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('preview-diagram', currentContent);
    preview.innerHTML = svg;

    // Initialize panzoom on the new SVG element
    const svgElement = preview.querySelector('svg');
    if (svgElement) {
      panzoomInstance = Panzoom(svgElement, {
        maxScale: 5,
        minScale: 0.1,
        canvas: true,
        startScale: preserveZoom && !isFirstRender ? savedScale : 1,
        startX: preserveZoom && !isFirstRender ? savedPan.x : 0,
        startY: preserveZoom && !isFirstRender ? savedPan.y : 0,
      });

      // Mouse wheel zoom (works without Ctrl key)
      // Store the handler so we can remove it later
      wheelHandler = panzoomInstance.zoomWithWheel;
      preview.addEventListener('wheel', wheelHandler);

      // Track zoom changes
      svgElement.addEventListener('panzoomchange', (event) => {
        currentScale = event.detail.scale;
        updateZoomDisplay();
      });

      // Only fit-to-page on first render or when not preserving zoom
      if (isFirstRender || !preserveZoom) {
        requestAnimationFrame(() => {
          const svgRect = svgElement.getBoundingClientRect();
          const containerRect = preview.getBoundingClientRect();

          // Calculate scale to fit with 10% padding
          const scaleX = (containerRect.width * 0.9) / svgRect.width;
          const scaleY = (containerRect.height * 0.9) / svgRect.height;
          const fitScale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

          if (fitScale < 1 && fitScale > 0) {
            panzoomInstance.zoom(fitScale);
          }

          currentScale = fitScale;
          updateZoomDisplay();
        });
      } else {
        // Restore saved zoom state
        currentScale = savedScale;
        updateZoomDisplay();
      }
    }

    hideError();
  } catch (error) {
    showError(error.message);
  }
}

// Save diagram
async function saveDiagram() {
  // Track what we're saving so we can ignore our own WebSocket echo
  lastSavedContent = currentContent;
  const result = await api.updateDiagram(diagramId, currentContent);

  if (!result.success) {
    showError(`${result.error}${result.line ? ` (line ${result.line})` : ''}`);
  } else {
    hideError();
  }
}

// Auto-save with debounce
function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    await saveDiagram();
  }, 500);
}

// Auto-refresh preview with debounce (2 second pause)
function scheduleAutoRefresh() {
  if (refreshTimeout) clearTimeout(refreshTimeout);

  refreshTimeout = setTimeout(() => {
    renderPreview();
  }, 2000);
}

// Error handling
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
}

// Undo/Redo
function pushUndo(content) {
  undoStack.push(content);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  if (undoStack.length <= 1) return;

  const current = undoStack.pop();
  redoStack.push(current);
  currentContent = undoStack[undoStack.length - 1];
  setEditorContent(currentContent);
  renderPreview();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;

  const content = redoStack.pop();
  undoStack.push(content);
  currentContent = content;
  setEditorContent(currentContent);
  renderPreview();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
}

// Export functions
async function exportSVG() {
  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${diagramId}.svg`;
  a.click();

  URL.revokeObjectURL(url);
}

async function exportPNG() {
  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diagramId}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
}

function copyCode() {
  navigator.clipboard.writeText(currentContent);
  const originalText = copyCodeBtn.textContent;
  copyCodeBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyCodeBtn.textContent = originalText;
  }, 2000);
}

// Zoom controls
function updateZoomDisplay() {
  const percent = Math.round(currentScale * 100);
  zoomLevel.textContent = `${percent}%`;
}

function zoomIn() {
  if (panzoomInstance) {
    panzoomInstance.zoomIn();
  }
}

function zoomOut() {
  if (panzoomInstance) {
    panzoomInstance.zoomOut();
  }
}

function zoomReset() {
  if (panzoomInstance) {
    panzoomInstance.reset();
  }
}

function zoomFit() {
  if (!panzoomInstance) return;

  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  requestAnimationFrame(() => {
    // Get natural SVG size (viewBox or width/height attributes)
    const viewBox = svgElement.viewBox.baseVal;
    const svgWidth = viewBox.width || svgElement.width.baseVal.value;
    const svgHeight = viewBox.height || svgElement.height.baseVal.value;

    // Get container size
    const containerRect = preview.getBoundingClientRect();

    // Calculate scale to fit both dimensions with padding
    const scaleX = (containerRect.width * 0.9) / svgWidth;
    const scaleY = (containerRect.height * 0.9) / svgHeight;
    const targetScale = Math.min(scaleX, scaleY);

    // Use panzoom's zoom method with absolute option
    if (targetScale > 0) {
      panzoomInstance.zoom(targetScale, { animate: false });
      // Pan to center
      panzoomInstance.pan(0, 0);
    }
  });
}

function zoomFitWidth() {
  if (!panzoomInstance) return;

  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  requestAnimationFrame(() => {
    // Get natural SVG width
    const viewBox = svgElement.viewBox.baseVal;
    const svgWidth = viewBox.width || svgElement.width.baseVal.value;

    // Get container width
    const containerRect = preview.getBoundingClientRect();

    // Calculate scale to fit width with padding
    const targetScale = (containerRect.width * 0.9) / svgWidth;

    // Use panzoom's zoom method with absolute option
    if (targetScale > 0) {
      panzoomInstance.zoom(targetScale, { animate: false });
      // Pan to center horizontally, keep vertical position
      panzoomInstance.pan(0, panzoomInstance.getPan().y);
    }
  });
}

function zoomFitHeight() {
  if (!panzoomInstance) return;

  const svgElement = preview.querySelector('svg');
  if (!svgElement) return;

  requestAnimationFrame(() => {
    // Get natural SVG height
    const viewBox = svgElement.viewBox.baseVal;
    const svgHeight = viewBox.height || svgElement.height.baseVal.value;

    // Get container height
    const containerRect = preview.getBoundingClientRect();

    // Calculate scale to fit height with padding
    const targetScale = (containerRect.height * 0.9) / svgHeight;

    // Use panzoom's zoom method with absolute option
    if (targetScale > 0) {
      panzoomInstance.zoom(targetScale, { animate: false });
      // Pan to center vertically, keep horizontal position
      panzoomInstance.pan(panzoomInstance.getPan().x, 0);
    }
  });
}

// Resizable split pane
let isResizing = false;

function initResizer() {
  // Load saved width from localStorage
  const savedWidth = localStorage.getItem('editorPaneWidth');
  if (savedWidth) {
    editorPane.style.flexBasis = savedWidth;
  }

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const splitPaneRect = splitPane.getBoundingClientRect();
    const newWidth = e.clientX - splitPaneRect.left;
    const percentage = (newWidth / splitPaneRect.width) * 100;

    // Constrain between 20% and 80%
    if (percentage >= 20 && percentage <= 80) {
      editorPane.style.flexBasis = `${percentage}%`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save width to localStorage
      localStorage.setItem('editorPaneWidth', editorPane.style.flexBasis);
    }
  });
}

// Toggle direction
function toggleDirection() {
  // Try to match wireframe diagrams first: wireframe [viewport] [direction]
  const wireframeRegex = /^wireframe\s+(mobile|tablet|desktop)?\s*(TD|LR)?/mi;
  const wireframeMatch = currentContent.match(wireframeRegex);

  if (wireframeMatch) {
    const viewport = wireframeMatch[1] || '';
    const currentDirection = wireframeMatch[2] || 'LR'; // Default is LR for wireframe

    // Toggle between LR and TD
    const newDirection = (currentDirection === 'LR') ? 'TD' : 'LR';

    // Build replacement string
    let replacement = 'wireframe';
    if (viewport) {
      replacement += ` ${viewport}`;
    }
    replacement += ` ${newDirection}`;

    const newContent = currentContent.replace(wireframeRegex, replacement);

    // Update editor and render
    pushUndo(currentContent);
    currentContent = newContent;
    setEditorContent(currentContent);
    renderPreview(false); // Reset zoom since layout changes
    scheduleAutoSave();
    return;
  }

  // Try to match graph/flowchart declarations with direction
  const directionRegex = /^(graph|flowchart)\s+(TD|TB|BT|RL|LR)/m;
  const match = currentContent.match(directionRegex);

  if (!match) {
    // No direction found - possibly not a flowchart or already has no direction
    showError('No direction found. This diagram may not support direction changes.');
    setTimeout(hideError, 3000);
    return;
  }

  const diagramType = match[1]; // 'graph' or 'flowchart'
  const currentDirection = match[2]; // TD, TB, BT, RL, or LR

  // Toggle between LR and TD
  let newDirection;
  if (currentDirection === 'LR' || currentDirection === 'RL') {
    newDirection = 'TD';
  } else {
    newDirection = 'LR';
  }

  // Replace the direction
  const newContent = currentContent.replace(directionRegex, `${diagramType} ${newDirection}`);

  // Update editor and render
  pushUndo(currentContent);
  currentContent = newContent;
  setEditorContent(currentContent);
  renderPreview(false); // Reset zoom since layout changes
  scheduleAutoSave();
}

// Event listeners
backButton.addEventListener('click', () => {
  window.location.href = '/';
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
exportSvgBtn.addEventListener('click', exportSVG);
exportPngBtn.addEventListener('click', exportPNG);
copyCodeBtn.addEventListener('click', copyCode);
zoomInBtn.addEventListener('click', zoomIn);
zoomOutBtn.addEventListener('click', zoomOut);
zoomResetBtn.addEventListener('click', zoomReset);
zoomFitBtn.addEventListener('click', zoomFit);
zoomFitWidthBtn.addEventListener('click', zoomFitWidth);
zoomFitHeightBtn.addEventListener('click', zoomFitHeight);
toggleDirectionBtn.addEventListener('click', toggleDirection);
refreshPreviewBtn.addEventListener('click', () => renderPreview());

// Keyboard shortcut: Ctrl+Enter to refresh preview
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    renderPreview();
  }
});

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

  // Re-subscribe when connection is established/re-established
  if (newStatus === 'connected') {
    api.subscribe(diagramId);
  }
});

api.onWebSocketMessage((message) => {
  if (message.type === 'diagram_updated' && message.id === diagramId) {
    // Ignore our own WebSocket echo (content matches what we just saved)
    if (message.content === lastSavedContent) {
      return;
    }

    // External update - auto-reload if content different from what's in editor
    if (message.content !== currentContent) {
      currentContent = message.content;
      lastSavedContent = message.content; // Update so we don't echo back
      setEditorContent(currentContent);
      pushUndo(currentContent);
      renderPreview();

      // Show brief notification
      const notification = document.createElement('div');
      notification.textContent = '✓ Diagram updated';
      notification.style.cssText = 'position: fixed; top: 60px; right: 20px; background: #4caf50; color: white; padding: 12px 20px; border-radius: 4px; z-index: 1000; animation: slideIn 0.3s ease;';
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    }
  }
});

status.addEventListener('click', () => {
  if (api.connectionStatus === 'disconnected') {
    api.reconnect();
  }
});

// Theme toggle
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    toggleTheme();
    recreateEditorWithTheme();
  });
}

// Syntax Help
const wireframeSyntax = `
<h3>Basic Structure</h3>
<pre><code>wireframe [viewport] [direction]
  screen "Screen Name"
    components...</code></pre>
<p><strong>Viewport:</strong> <code>mobile</code> (375px), <code>tablet</code> (768px), <code>desktop</code> (1200px)</p>
<p><strong>Direction:</strong> <code>LR</code> (left-right), <code>TD</code> (top-down)</p>

<h3>Layout Containers</h3>
<table>
  <tr><th>Component</th><th>Description</th></tr>
  <tr><td><code>col</code></td><td>Vertical container (stack children top to bottom)</td></tr>
  <tr><td><code>row</code></td><td>Horizontal container (stack children left to right)</td></tr>
  <tr><td><code>Card</code></td><td>Card container with border and rounded corners</td></tr>
  <tr><td><code>screen "Name"</code></td><td>Screen container with label</td></tr>
</table>

<h3>UI Components</h3>
<table>
  <tr><th>Component</th><th>Usage</th></tr>
  <tr><td><code>Text "label"</code></td><td>Text display</td></tr>
  <tr><td><code>Title "label"</code></td><td>Larger heading text</td></tr>
  <tr><td><code>Button "label"</code></td><td>Button (add: primary, secondary, danger, success, disabled)</td></tr>
  <tr><td><code>Input "placeholder"</code></td><td>Text input field</td></tr>
  <tr><td><code>Checkbox "label"</code></td><td>Checkbox with label</td></tr>
  <tr><td><code>Radio "label"</code></td><td>Radio button with label</td></tr>
  <tr><td><code>Switch "label"</code></td><td>Toggle switch</td></tr>
  <tr><td><code>Dropdown "label"</code></td><td>Dropdown select</td></tr>
  <tr><td><code>List "A|B|C"</code></td><td>List (pipe-separated items)</td></tr>
  <tr><td><code>AppBar "title"</code></td><td>Top app bar</td></tr>
  <tr><td><code>BottomNav "A|B|C"</code></td><td>Bottom navigation</td></tr>
  <tr><td><code>NavMenu "A|B|C"</code></td><td>Navigation menu</td></tr>
  <tr><td><code>FAB "+"</code></td><td>Floating action button</td></tr>
  <tr><td><code>Avatar</code></td><td>User avatar circle</td></tr>
  <tr><td><code>Icon "name"</code></td><td>Icon placeholder</td></tr>
  <tr><td><code>Image</code></td><td>Image placeholder</td></tr>
  <tr><td><code>spacer</code></td><td>Flexible space (expands)</td></tr>
  <tr><td><code>divider</code></td><td>Horizontal line</td></tr>
</table>

<h3>Grid/Table</h3>
<pre><code>Grid
  header "Col1|Col2|Col3"
  row "A|B|C"
  row "D|E|F"</code></pre>

<h3>Modifiers</h3>
<table>
  <tr><th>Modifier</th><th>Example</th><th>Description</th></tr>
  <tr><td><code>flex</code></td><td><code>col flex</code></td><td>Expand to fill available space</td></tr>
  <tr><td><code>flex=N</code></td><td><code>col flex=2</code></td><td>Flex with weight</td></tr>
  <tr><td><code>width=N</code></td><td><code>Button "OK" width=100</code></td><td>Fixed width in pixels</td></tr>
  <tr><td><code>height=N</code></td><td><code>Image height=200</code></td><td>Fixed height in pixels</td></tr>
  <tr><td><code>padding=N</code></td><td><code>Card padding=16</code></td><td>Inner padding</td></tr>
</table>

<h3>Example</h3>
<pre><code>wireframe mobile
  screen "Login"
    col padding=16
      spacer
      Title "Welcome"
      Input "Email"
      Input "Password"
      Button "Sign In" primary
      spacer
      Text "Forgot password?"</code></pre>
`;

const mermaidSyntax = `
<h3>Flowchart</h3>
<pre><code>flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action 1]
  B -->|No| D[Action 2]
  C --> E[End]
  D --> E</code></pre>

<h3>Node Shapes</h3>
<table>
  <tr><th>Syntax</th><th>Shape</th></tr>
  <tr><td><code>A[text]</code></td><td>Rectangle</td></tr>
  <tr><td><code>A(text)</code></td><td>Rounded rectangle</td></tr>
  <tr><td><code>A{text}</code></td><td>Diamond (decision)</td></tr>
  <tr><td><code>A((text))</code></td><td>Circle</td></tr>
  <tr><td><code>A[[text]]</code></td><td>Subroutine</td></tr>
  <tr><td><code>A[(text)]</code></td><td>Database</td></tr>
  <tr><td><code>A>text]</code></td><td>Flag/ribbon</td></tr>
</table>

<h3>Arrow Types</h3>
<table>
  <tr><th>Syntax</th><th>Description</th></tr>
  <tr><td><code>--></code></td><td>Arrow</td></tr>
  <tr><td><code>---</code></td><td>Line (no arrow)</td></tr>
  <tr><td><code>-.->|</code></td><td>Dotted arrow</td></tr>
  <tr><td><code>==></code></td><td>Thick arrow</td></tr>
  <tr><td><code>-->|text|</code></td><td>Arrow with label</td></tr>
</table>

<h3>Direction</h3>
<p><code>TD</code>/<code>TB</code> (top-down), <code>LR</code> (left-right), <code>RL</code> (right-left), <code>BT</code> (bottom-top)</p>

<h3>Subgraphs</h3>
<pre><code>flowchart TD
  subgraph Group1[Title]
    A --> B
  end
  subgraph Group2
    C --> D
  end
  B --> C</code></pre>

<h3>Sequence Diagram</h3>
<pre><code>sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: Hello
  B-->>A: Hi there
  A->>B: How are you?
  Note over A,B: A note</code></pre>

<h3>State Diagram</h3>
<pre><code>stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Done: complete
  Processing --> Error: fail
  Done --> [*]</code></pre>

<h3>Class Diagram</h3>
<pre><code>classDiagram
  class Animal {
    +String name
    +makeSound()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog</code></pre>

<h3>ER Diagram</h3>
<pre><code>erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "is in"</code></pre>

<h3>Styling</h3>
<pre><code>flowchart TD
  A[Node]
  style A fill:#f9f,stroke:#333
  classDef highlight fill:#ff0
  B[Highlighted]:::highlight</code></pre>
`;

function showSyntaxHelp() {
  const diagramType = detectDiagramType(currentContent);

  if (diagramType === 'wireframe') {
    syntaxModalTitle.textContent = 'Wireframe Syntax Reference';
    syntaxModalBody.innerHTML = wireframeSyntax;
  } else {
    syntaxModalTitle.textContent = 'Mermaid Syntax Reference';
    syntaxModalBody.innerHTML = mermaidSyntax;
  }

  syntaxModal.classList.add('visible');
}

function hideSyntaxHelp() {
  syntaxModal.classList.remove('visible');
}

syntaxHelpBtn.addEventListener('click', showSyntaxHelp);
syntaxModalClose.addEventListener('click', hideSyntaxHelp);
syntaxModal.addEventListener('click', (e) => {
  if (e.target === syntaxModal) {
    hideSyntaxHelp();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && syntaxModal.classList.contains('visible')) {
    hideSyntaxHelp();
  }
});

// Subscribe to theme changes from other sources
onThemeChange(() => {
  recreateEditorWithTheme();
});

// Initialize
initTheme();
initResizer();
api.connectWebSocket();
loadDiagram();
