import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
import * as wireframe from './plugins/mermaid-wireframe.js';
import APIClient from './api-client.js';

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
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const themeSelect = document.getElementById('theme');
const errorBanner = document.getElementById('error');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const exportSvgBtn = document.getElementById('export-svg');
const exportPngBtn = document.getElementById('export-png');
const copyCodeBtn = document.getElementById('copy-code');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const zoomFitBtn = document.getElementById('zoom-fit');
const zoomLevel = document.getElementById('zoom-level');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');

// State
let currentContent = '';
let currentTheme = 'default';
let saveTimeout = null;
let undoStack = [];
let redoStack = [];
let panzoomInstance = null;
let currentScale = 1;

// Load diagram
async function loadDiagram() {
  const diagram = await api.getDiagram(diagramId);
  title.textContent = diagram.name;
  currentContent = diagram.content;
  editor.value = currentContent;
  undoStack = [currentContent];
  renderPreview();
}

// Render preview
async function renderPreview() {
  try {
    mermaid.initialize({
      theme: currentTheme,
      startOnLoad: false,
    });

    const { svg } = await mermaid.render('preview-diagram', currentContent);
    preview.innerHTML = svg;

    // Cleanup old panzoom instance
    if (panzoomInstance) {
      panzoomInstance.destroy();
      panzoomInstance = null;
    }

    // Initialize panzoom on the new SVG element
    const svgElement = preview.querySelector('svg');
    if (svgElement) {
      panzoomInstance = Panzoom(svgElement, {
        maxScale: 5,
        minScale: 0.1,
        canvas: true,
      });

      // Mouse wheel zoom (works without Ctrl key)
      preview.addEventListener('wheel', panzoomInstance.zoomWithWheel);

      // Track zoom changes
      svgElement.addEventListener('panzoomchange', (event) => {
        currentScale = event.detail.scale;
        updateZoomDisplay();
      });

      // Calculate and apply fit-to-page zoom
      const svgRect = svgElement.getBoundingClientRect();
      const containerRect = preview.getBoundingClientRect();

      // Calculate scale to fit with 10% padding
      const scaleX = (containerRect.width * 0.9) / svgRect.width;
      const scaleY = (containerRect.height * 0.9) / svgRect.height;
      const fitScale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

      if (fitScale < 1) {
        panzoomInstance.zoom(fitScale);
      }

      currentScale = fitScale;
      updateZoomDisplay();
    }

    hideError();
  } catch (error) {
    showError(error.message);
  }
}

// Save diagram
async function saveDiagram() {
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
  editor.value = currentContent;
  renderPreview();
  updateUndoRedoButtons();
}

function redo() {
  if (redoStack.length === 0) return;

  const content = redoStack.pop();
  undoStack.push(content);
  currentContent = content;
  editor.value = currentContent;
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

  // Reset first to get accurate measurements
  panzoomInstance.reset();

  // Recalculate fit scale
  const svgRect = svgElement.getBoundingClientRect();
  const containerRect = preview.getBoundingClientRect();

  const scaleX = (containerRect.width * 0.9) / svgRect.width;
  const scaleY = (containerRect.height * 0.9) / svgRect.height;
  const fitScale = Math.min(scaleX, scaleY, 1);

  if (fitScale < 1) {
    panzoomInstance.zoom(fitScale);
  }
}

// Event listeners
editor.addEventListener('input', (e) => {
  const newContent = e.target.value;
  if (newContent !== currentContent) {
    pushUndo(currentContent);
    currentContent = newContent;
    renderPreview();
    scheduleAutoSave();
  }
});

themeSelect.addEventListener('change', (e) => {
  currentTheme = e.target.value;
  renderPreview();
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

// WebSocket
api.onStatusChange((newStatus) => {
  status.className = `connection-status ${newStatus}`;
  statusText.textContent = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
});

api.onWebSocketMessage((message) => {
  if (message.type === 'diagram_updated' && message.id === diagramId) {
    // External update - auto-reload if content different
    if (message.content !== currentContent) {
      currentContent = message.content;
      editor.value = currentContent;
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

// Initialize
api.connectWebSocket();
api.subscribe(diagramId);
loadDiagram();
