import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
import * as wireframe from './plugins/mermaid-wireframe.js';
import APIClient from './api-client.js';
import { EditorView } from 'https://esm.sh/@codemirror/view@6';
import { EditorState } from 'https://esm.sh/@codemirror/state@6';
import { history, historyKeymap } from 'https://esm.sh/@codemirror/commands@6';
import { lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from 'https://esm.sh/@codemirror/view@6';
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from 'https://esm.sh/@codemirror/language@6';
import { defaultKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { searchKeymap, highlightSelectionMatches } from 'https://esm.sh/@codemirror/search@6';
import { autocompletion, completionKeymap } from 'https://esm.sh/@codemirror/autocomplete@6';
import { keymap } from 'https://esm.sh/@codemirror/view@6';

// Custom editor setup without closeBrackets (which causes aggressive backspace deletion)
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
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  // closeBrackets() - intentionally omitted
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
import { mermaidLanguage } from './cm-lang-mermaid.js';
import { wireframeLanguage } from './cm-lang-wireframe.js';
import { initTheme, toggleTheme, getTheme, onThemeChange, getEditorTheme } from './theme.js?v=4';

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
const formatCodeBtn = document.getElementById('format-code');
const createNodeBtn = document.getElementById('create-node');
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

// Get Mermaid theme based on app theme
function getMermaidTheme() {
  return getTheme() === 'dark' ? 'dark' : 'default';
}
let saveTimeout = null;
let refreshTimeout = null;
let undoStack = [];
let redoStack = [];
let panzoomInstance = null;
let currentScale = 1;
let wheelHandler = null;
let editorView = null;
let lastSavedContent = ''; // Track what we last saved to ignore our own WebSocket echoes

// Edge editing state
let currentEdgeInfo = null;  // { source, target, lineIndex, lineContent }
let isSelectingDestination = false;
let isSelectingOrigin = false;

// Node editing state
let currentNodeInfo = null;  // { nodeId, lineIndex, lineContent }

// Edge context menu elements
const edgeContextMenu = document.getElementById('edge-context-menu');
const edgeEditLabel = document.getElementById('edge-edit-label');
const edgeChangeDest = document.getElementById('edge-change-dest');
const edgeDelete = document.getElementById('edge-delete');
const modeIndicator = document.getElementById('mode-indicator');
const modeCancel = document.getElementById('mode-cancel');

// Node context menu elements
const nodeContextMenu = document.getElementById('node-context-menu');
const nodeEditDesc = document.getElementById('node-edit-desc');
const nodeChangeType = document.getElementById('node-change-type');
const nodeAddTransition = document.getElementById('node-add-transition');
const nodeAddTransitionNew = document.getElementById('node-add-transition-new');
const nodeDelete = document.getElementById('node-delete');

// Edge context menu - origin and destination options
const edgeChangeOrigin = document.getElementById('edge-change-origin');
const edgeChangeOriginNew = document.getElementById('edge-change-origin-new');
const edgeChangeDestNew = document.getElementById('edge-change-dest-new');

// Additional state for add transition mode
let isAddingTransition = false;
let pendingTransitionLabel = '';
let pendingSourceNode = null;

// Node type configurations
const NODE_TYPES = {
  terminal: {
    name: 'Terminal (Start/End)',
    shape: (id, label) => `${id}(["${label}"])`,
    style: 'fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px',
    pattern: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\[.*?\]\)\s*$/
  },
  state: {
    name: 'State',
    shape: (id, label) => `${id}(("${label}"))`,
    style: 'fill:#bbdefb,stroke:#1976d2,stroke-width:2px',
    pattern: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\(.*?\)\)\s*$/
  },
  decision: {
    name: 'Decision',
    shape: (id, label) => `${id}{"${label}"}`,
    style: 'fill:#fff9c4,stroke:#f9a825,stroke-width:2px',
    pattern: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\{.*?\}\s*$/
  },
  action: {
    name: 'Action',
    shape: (id, label) => `${id}["${label}"]`,
    style: 'fill:#ffe0b2,stroke:#f57c00,stroke-width:2px',
    pattern: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[.*?\]\s*$/
  }
};

// Detect node type from its definition
function detectNodeType(nodeDefinition) {
  // Check inline definitions in connections too
  const trimmed = nodeDefinition.trim();

  // Terminal: ([...])
  if (/\(\[.*?\]\)/.test(trimmed)) return 'terminal';
  // State: ((...))
  if (/\(\(.*?\)\)/.test(trimmed)) return 'state';
  // Decision: {...}
  if (/\{.*?\}/.test(trimmed) && !/^\s*style\s/i.test(trimmed)) return 'decision';
  // Action: [...] (default rectangle)
  if (/\[.*?\]/.test(trimmed)) return 'action';

  return 'action'; // Default
}

// Prompt user to select a node type
function promptNodeType() {
  const options = Object.entries(NODE_TYPES)
    .map(([key, config], i) => `${i + 1}. ${config.name}`)
    .join('\n');

  const choice = prompt(`Select node type:\n${options}\n\nEnter number (1-4):`);
  if (!choice) return null;

  const index = parseInt(choice) - 1;
  const keys = Object.keys(NODE_TYPES);
  if (index >= 0 && index < keys.length) {
    return keys[index];
  }
  return null;
}

// Create node definition line based on type
function createNodeDefinition(nodeId, description, nodeType) {
  const typeConfig = NODE_TYPES[nodeType] || NODE_TYPES.action;
  const label = description.trim() || nodeId;
  return `    ${typeConfig.shape(nodeId, label)}`;
}

// Add or update style for a node
function addStyleForNode(content, nodeId, nodeType) {
  const typeConfig = NODE_TYPES[nodeType] || NODE_TYPES.action;
  const styleLine = `    style ${nodeId} ${typeConfig.style}`;

  // Check if style already exists for this node
  const existingStyleRegex = new RegExp(`^\\s*style\\s+${escapeRegex(nodeId)}\\s+`, 'm');

  if (existingStyleRegex.test(content)) {
    // Update existing style
    return content.replace(existingStyleRegex, `    style ${nodeId} `).replace(
      new RegExp(`(style\\s+${escapeRegex(nodeId)}\\s+).*$`, 'm'),
      `$1${typeConfig.style}`
    );
  } else {
    // Add new style at the end (before closing or at very end)
    const lines = content.split('\n');

    // Find if there's a styles section or add before end
    let insertIndex = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*style\s+/i.test(lines[i])) {
        insertIndex = i + 1;
        break;
      }
    }

    lines.splice(insertIndex, 0, styleLine);
    return lines.join('\n');
  }
}

// Extract label from a node definition for a specific nodeId
function extractNodeLabel(nodeDefinition, nodeId) {
  if (!nodeId) {
    // Fallback to old behavior if no nodeId provided - match any pattern
    const patterns = [
      /\(\["([^"]+)"\]\)/,  // Terminal: (["label"])
      /\(\("([^"]+)"\)\)/,  // State: (("label"))
      /\{"([^"]+)"\}/,      // Decision: {"label"}
      /\["([^"]+)"\]/,      // Action: ["label"]
      /\[([^\]]+)\]/,       // Action without quotes: [label]
    ];

    for (const pattern of patterns) {
      const match = nodeDefinition.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Build patterns that specifically look for nodeId followed by bracket patterns
  const escapedId = escapeRegex(nodeId);
  const patterns = [
    new RegExp(`${escapedId}\\s*\\(\\["([^"]+)"\\]\\)`),  // Terminal: NodeId(["label"])
    new RegExp(`${escapedId}\\s*\\(\\("([^"]+)"\\)\\)`),  // State: NodeId(("label"))
    new RegExp(`${escapedId}\\s*\\{"([^"]+)"\\}`),        // Decision: NodeId{"label"}
    new RegExp(`${escapedId}\\s*\\["([^"]+)"\\]`),        // Action with quotes: NodeId["label"]
    new RegExp(`${escapedId}\\s*\\[([^\\]]+)\\]`),        // Action without quotes: NodeId[label]
    new RegExp(`${escapedId}\\s*\\(\\(([^)]+)\\)\\)`),    // State without quotes: NodeId((label))
    new RegExp(`${escapedId}\\s*\\(\\[([^\\]]+)\\]\\)`),  // Terminal without quotes: NodeId([label])
  ];

  for (const pattern of patterns) {
    const match = nodeDefinition.match(pattern);
    if (match) return match[1];
  }

  return null;
}

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
      ...customSetup,
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
      ...customSetup,
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
      theme: getMermaidTheme(),
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

      // Add click-to-source navigation
      setupClickToSource(svgElement);

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

// Setup click-to-source navigation on SVG elements
function setupClickToSource(svgElement) {
  // Find all clickable node elements
  const nodeSelectors = [
    '.node',           // Flowchart/graph nodes
    '.cluster',        // Subgraphs
    '.actor',          // Sequence diagram actors
    '.messageText',    // Sequence diagram messages
    '.activation',     // Sequence diagram activations
    '.statediagram-state', // State diagram states
    '.node-label',     // Node labels
    '[id*="flowchart-"]',  // Flowchart elements by ID pattern
    '[id*="state-"]',      // State elements
  ];

  // Find all clickable edge/arrow elements
  const edgeSelectors = [
    '.edgePath',       // Flowchart edges
    '.edge',           // Generic edges
    '.messageLine0',   // Sequence diagram messages
    '.messageLine1',   // Sequence diagram messages
    '.transition',     // State diagram transitions
    '[id^="L-"]',      // Link elements by ID pattern (L-source-target)
    '[id*="-to-"]',    // Alternative link pattern
  ];

  // Setup node click handlers
  const nodes = svgElement.querySelectorAll(nodeSelectors.join(', '));
  nodes.forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeId = extractNodeId(el);
      if (nodeId) {
        // Check if we're in destination selection mode (for changing edge destination)
        if (isSelectingDestination) {
          handleDestinationSelection(nodeId);
        }
        // Check if we're in origin selection mode (for changing edge origin)
        else if (isSelectingOrigin) {
          handleOriginSelection(nodeId);
        }
        // Check if we're adding a new transition
        else if (isAddingTransition) {
          handleAddTransitionDestination(nodeId);
        }
        else {
          // Scroll to source
          const lineInfo = scrollToNodeInSource(nodeId);

          // Show context menu
          if (lineInfo) {
            currentNodeInfo = { nodeId, ...lineInfo };
            showNodeContextMenu(e.clientX, e.clientY);
          }
        }
      }
    });
  });

  // Setup edge/arrow click handlers
  const edges = svgElement.querySelectorAll(edgeSelectors.join(', '));
  edges.forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const edgeInfo = extractEdgeInfo(el);
      if (edgeInfo) {
        // Scroll to source
        const lineInfo = scrollToEdgeInSource(edgeInfo.source, edgeInfo.target);

        // Show context menu
        if (lineInfo) {
          currentEdgeInfo = { ...edgeInfo, ...lineInfo };
          showEdgeContextMenu(e.clientX, e.clientY);
        }
      }
    });
  });
}

// Extract node ID from an SVG element
function extractNodeId(element) {
  // Try getting ID from the element itself
  let id = element.id || '';

  // Common patterns in Mermaid SVG IDs:
  // flowchart-NodeId-123, state-NodeId-456, etc.
  let match = id.match(/(?:flowchart|state|statediagram)-([^-]+)/);
  if (match) return match[1];

  // Try data attributes
  if (element.dataset && element.dataset.id) {
    return element.dataset.id;
  }

  // Try to find ID in parent elements
  let parent = element.closest('[id]');
  if (parent && parent.id) {
    match = parent.id.match(/(?:flowchart|state|statediagram)-([^-]+)/);
    if (match) return match[1];

    // Try generic pattern: word-NodeId-number
    match = parent.id.match(/^[a-z]+-([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) return match[1];
  }

  // Try to get text content as a fallback (for labels)
  const textEl = element.querySelector('text, .nodeLabel, .label');
  if (textEl) {
    const text = textEl.textContent.trim();
    // If text looks like a simple identifier, use it
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
      return text;
    }
  }

  // For sequence diagram actors
  if (element.classList.contains('actor')) {
    const text = element.querySelector('text');
    if (text) return text.textContent.trim();
  }

  return null;
}

// Extract edge/arrow info (source and target nodes)
function extractEdgeInfo(element) {
  let id = element.id || '';

  // Pattern: L-source-target-number (e.g., L-A-B-0)
  let match = id.match(/^L-([^-]+)-([^-]+)/);
  if (match) {
    return { source: match[1], target: match[2] };
  }

  // Pattern: edge-source-target or similar
  match = id.match(/edge[^-]*-([^-]+)-([^-]+)/i);
  if (match) {
    return { source: match[1], target: match[2] };
  }

  // Try parent element
  let parent = element.closest('[id]');
  if (parent && parent.id) {
    match = parent.id.match(/^L-([^-]+)-([^-]+)/);
    if (match) {
      return { source: match[1], target: match[2] };
    }
  }

  // For edgePath elements, try to find the marker-end reference
  const path = element.querySelector('path') || element;
  if (path.getAttribute) {
    const markerEnd = path.getAttribute('marker-end');
    if (markerEnd) {
      // Extract from marker reference
      match = markerEnd.match(/url\(#[^-]+-([^-]+)-([^-]+)/);
      if (match) {
        return { source: match[1], target: match[2] };
      }
    }
  }

  // Try looking at the class for clues
  const classList = Array.from(element.classList || []);
  for (const cls of classList) {
    match = cls.match(/^LS-([^-]+)-([^-]+)/);
    if (match) {
      return { source: match[1], target: match[2] };
    }
  }

  return null;
}

// Scroll to an edge/transition definition in the source code
function scrollToEdgeInSource(source, target) {
  const content = getEditorContent();
  const lines = content.split('\n');

  // Patterns to match edge/transition definitions:
  // - source --> target, source --text--> target
  // - source ==> target, source ==text==> target
  // - source -.-> target, source -.text.-> target
  // - source --- target
  // - source ->> target (sequence diagram)
  // - source : event (state diagram transition on same line)

  const arrowPatterns = [
    '-->',
    '==>',
    '-.->',
    '-.->',
    '---',
    '->>',
    '-->>',
    '->',
    '=>',
  ];

  let foundLine = -1;
  let foundCol = 0;

  // Build regex patterns for source -> target connections
  const patterns = arrowPatterns.map(arrow => {
    const escapedArrow = arrow.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    // Match: source (optional text in arrow) arrow target
    return new RegExp(`${escapeRegex(source)}\\s*(?:--[^>]*|==[^>]*|-\\.[^>]*)?${escapedArrow}\\s*(?:\\|[^|]*\\|)?\\s*${escapeRegex(target)}`);
  });

  // Also check for state diagram transitions: source --> target : event
  patterns.push(new RegExp(`${escapeRegex(source)}\\s*-->\\s*${escapeRegex(target)}\\s*:`));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        foundLine = i;
        // Find the arrow position for better highlighting
        const idx = line.indexOf(source);
        if (idx !== -1) foundCol = idx;
        break;
      }
    }
    if (foundLine !== -1) break;
  }

  // Fallback: search for both source and target on same line
  if (foundLine === -1) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(source) && line.includes(target)) {
        foundLine = i;
        foundCol = line.indexOf(source);
        break;
      }
    }
  }

  if (foundLine !== -1 && editorView) {
    // Calculate position in document
    let pos = 0;
    for (let i = 0; i < foundLine; i++) {
      pos += lines[i].length + 1;
    }
    pos += foundCol;

    // Select the entire transition (from source to target)
    const line = lines[foundLine];
    const sourceIdx = line.indexOf(source);
    const targetIdx = line.lastIndexOf(target);
    const selectEnd = targetIdx !== -1 ? targetIdx + target.length : sourceIdx + source.length;

    editorView.dispatch({
      selection: { anchor: pos, head: pos + (selectEnd - sourceIdx) },
      scrollIntoView: true,
    });
    editorView.focus();

    highlightLine(foundLine);

    // Return line info for context menu operations
    return { lineIndex: foundLine, lineContent: line };
  }

  return null;
}

// Scroll to a node definition in the source code
function scrollToNodeInSource(nodeId) {
  const content = getEditorContent();
  const lines = content.split('\n');

  // Patterns to match node definitions:
  // - NodeId[label] or NodeId(label) or NodeId{label} - flowchart nodes
  // - NodeId --> or NodeId--- - flowchart connections (first occurrence)
  // - participant NodeId or actor NodeId - sequence diagram
  // - state NodeId or NodeId: description - state diagram
  // - subgraph NodeId - subgraphs

  const patterns = [
    new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*[\\[\\(\\{\\>]`),      // NodeId[ or NodeId( etc
    new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*--`),                   // NodeId-- (connection start)
    new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*==`),                   // NodeId== (thick connection)
    new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*-\\.`),                 // NodeId-. (dotted connection)
    new RegExp(`^\\s*(participant|actor)\\s+${escapeRegex(nodeId)}`, 'i'),  // participant/actor
    new RegExp(`^\\s*state\\s+${escapeRegex(nodeId)}`, 'i'),           // state NodeId
    new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*:`),                    // NodeId: (state description)
    new RegExp(`^\\s*subgraph\\s+${escapeRegex(nodeId)}`, 'i'),        // subgraph NodeId
    new RegExp(`-->\\s*${escapeRegex(nodeId)}\\s*[\\[\\(\\{]`),        // --> NodeId[ (target with label)
    new RegExp(`\\s${escapeRegex(nodeId)}\\s*$`),                      // ends with NodeId
  ];

  let foundLine = -1;
  let foundCol = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        foundLine = i;
        // Find column position of the nodeId
        const idx = line.indexOf(nodeId);
        if (idx !== -1) foundCol = idx;
        break;
      }
    }
    if (foundLine !== -1) break;
  }

  // If not found with patterns, try simple search
  if (foundLine === -1) {
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf(nodeId);
      if (idx !== -1) {
        foundLine = i;
        foundCol = idx;
        break;
      }
    }
  }

  if (foundLine !== -1 && editorView) {
    // Calculate position in document
    let pos = 0;
    for (let i = 0; i < foundLine; i++) {
      pos += lines[i].length + 1; // +1 for newline
    }
    pos += foundCol;

    // Scroll to line and select the nodeId
    editorView.dispatch({
      selection: { anchor: pos, head: pos + nodeId.length },
      scrollIntoView: true,
    });
    editorView.focus();

    // Brief highlight effect
    highlightLine(foundLine);

    // Return line info for context menu operations
    return { lineIndex: foundLine, lineContent: lines[foundLine] };
  }

  return null;
}

// Escape special regex characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Briefly highlight a line
function highlightLine(lineNumber) {
  const lineElement = editorContainer.querySelector(`.cm-line:nth-child(${lineNumber + 1})`);
  if (lineElement) {
    lineElement.style.transition = 'background-color 0.3s';
    lineElement.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
    setTimeout(() => {
      lineElement.style.backgroundColor = '';
    }, 1500);
  }
}

// ============================================================================
// Edge Context Menu
// ============================================================================

function showEdgeContextMenu(x, y) {
  // Hide node menu if open
  hideNodeContextMenu();

  // Make visible to measure actual size
  edgeContextMenu.style.left = '-9999px';
  edgeContextMenu.style.top = '-9999px';
  edgeContextMenu.classList.add('visible');

  // Measure actual dimensions
  const menuWidth = edgeContextMenu.offsetWidth;
  const menuHeight = edgeContextMenu.offsetHeight;

  // Position menu, ensuring it stays within viewport
  const maxX = window.innerWidth - menuWidth - 10;
  const maxY = window.innerHeight - menuHeight - 10;

  edgeContextMenu.style.left = Math.max(10, Math.min(x, maxX)) + 'px';
  edgeContextMenu.style.top = Math.max(10, Math.min(y, maxY)) + 'px';
}

function hideEdgeContextMenu() {
  edgeContextMenu.classList.remove('visible');
  currentEdgeInfo = null;
}

// Handle click outside to close menu
document.addEventListener('click', (e) => {
  // Don't hide/clear edge info if we're in destination or origin selection mode
  if (!edgeContextMenu.contains(e.target) && !isSelectingDestination && !isSelectingOrigin) {
    hideEdgeContextMenu();
  }
});

// Edit Label handler
edgeEditLabel.addEventListener('click', () => {
  if (!currentEdgeInfo) return;

  const { lineIndex, lineContent, source, target } = currentEdgeInfo;

  // Extract current label if any (between |pipes| or --text-->)
  let currentLabel = '';
  const pipeLabelMatch = lineContent.match(/\|([^|]*)\|/);
  const arrowLabelMatch = lineContent.match(/--([^->\s][^->]*)-->/);

  if (pipeLabelMatch) {
    currentLabel = pipeLabelMatch[1];
  } else if (arrowLabelMatch) {
    currentLabel = arrowLabelMatch[1];
  }

  const newLabel = prompt('Enter new label for this arrow:', currentLabel);
  if (newLabel === null) {
    hideEdgeContextMenu();
    return;
  }

  // Update the line with new label
  let newLine;
  if (newLabel.trim() === '') {
    // Remove label - convert to plain arrow
    newLine = lineContent
      .replace(/\|[^|]*\|/g, '')
      .replace(/--[^->\s][^->]*-->/, '-->');
  } else if (pipeLabelMatch) {
    // Replace existing pipe label
    newLine = lineContent.replace(/\|[^|]*\|/, `|${newLabel}|`);
  } else if (arrowLabelMatch) {
    // Replace existing arrow label
    newLine = lineContent.replace(/--[^->\s][^->]*-->/, `--${newLabel}-->`);
  } else {
    // Add new label using pipe syntax
    newLine = lineContent.replace(
      new RegExp(`(${escapeRegex(source)}\\s*)(-->)(\\s*${escapeRegex(target)})`),
      `$1$2|${newLabel}|$3`
    );
  }

  applyLineEdit(lineIndex, newLine);
  hideEdgeContextMenu();
});

// Change Origin handler
edgeChangeOrigin.addEventListener('click', () => {
  if (!currentEdgeInfo) return;

  // Hide menu but preserve currentEdgeInfo for origin selection
  edgeContextMenu.classList.remove('visible');

  isSelectingOrigin = true;
  document.getElementById('mode-indicator-text').textContent = 'Click a node to set as new origin';
  modeIndicator.classList.add('visible');

  // Change cursor style on preview pane
  preview.style.cursor = 'crosshair';
});

// Change Destination handler
edgeChangeDest.addEventListener('click', () => {
  if (!currentEdgeInfo) return;

  // Hide menu but preserve currentEdgeInfo for destination selection
  edgeContextMenu.classList.remove('visible');

  isSelectingDestination = true;
  document.getElementById('mode-indicator-text').textContent = 'Click a node to set as new destination';
  modeIndicator.classList.add('visible');

  // Change cursor style on preview pane
  preview.style.cursor = 'crosshair';
});

// Cancel destination selection mode
modeCancel.addEventListener('click', () => {
  exitDestinationMode();
});

// Also cancel on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (isSelectingDestination || isSelectingOrigin || isAddingTransition)) {
    exitDestinationMode();
  }
});

function exitDestinationMode() {
  isSelectingDestination = false;
  isSelectingOrigin = false;
  isAddingTransition = false;
  pendingTransitionLabel = '';
  pendingSourceNode = null;
  modeIndicator.classList.remove('visible');
  preview.style.cursor = '';
  currentEdgeInfo = null;
}

// Handle node click when in destination selection mode
async function handleDestinationSelection(nodeId) {
  if (!isSelectingDestination || !currentEdgeInfo) return false;

  const { lineIndex, lineContent, source, target } = currentEdgeInfo;

  // Replace old target with new target using last occurrence
  let newLine = lineContent;
  const targetRegex = new RegExp(`\\b${escapeRegex(target)}\\b`);
  if (targetRegex.test(lineContent)) {
    const lastIndex = lineContent.lastIndexOf(target);
    if (lastIndex !== -1) {
      newLine = lineContent.substring(0, lastIndex) + nodeId + lineContent.substring(lastIndex + target.length);
    }
  }

  if (newLine !== lineContent) {
    await applyLineEdit(lineIndex, newLine);
  }

  exitDestinationMode();
  return true;
}

// Handle node click when in origin selection mode
async function handleOriginSelection(nodeId) {
  if (!isSelectingOrigin || !currentEdgeInfo) return false;

  const { lineIndex, lineContent, source, target } = currentEdgeInfo;

  // Replace old source with new source using first occurrence
  let newLine = lineContent;
  const sourceRegex = new RegExp(`\\b${escapeRegex(source)}\\b`);
  if (sourceRegex.test(lineContent)) {
    const firstIndex = lineContent.indexOf(source);
    if (firstIndex !== -1) {
      newLine = lineContent.substring(0, firstIndex) + nodeId + lineContent.substring(firstIndex + source.length);
    }
  }

  if (newLine !== lineContent) {
    await applyLineEdit(lineIndex, newLine);
  }

  exitDestinationMode();
  return true;
}

// Delete Arrow handler
edgeDelete.addEventListener('click', async () => {
  if (!currentEdgeInfo) return;

  const { lineIndex } = currentEdgeInfo;

  if (confirm('Delete this arrow/transition?')) {
    await deleteLine(lineIndex);
  }

  hideEdgeContextMenu();
});

// Validate mermaid content before applying
async function validateMermaid(content) {
  try {
    // Use mermaid's parse function to validate without rendering
    await mermaid.parse(content);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Reserved Mermaid keywords that can't be used as node IDs
const MERMAID_RESERVED = new Set([
  'graph', 'flowchart', 'subgraph', 'end', 'direction',
  'click', 'style', 'classDef', 'class', 'linkStyle',
  'stateDiagram', 'stateDiagram-v2', 'state',
  'sequenceDiagram', 'participant', 'actor',
  'note', 'loop', 'alt', 'else', 'opt', 'par', 'and',
  'rect', 'activate', 'deactivate',
  'TD', 'TB', 'BT', 'LR', 'RL',
]);

// Validate a state/node ID
function validateStateId(id) {
  if (!id || !id.trim()) {
    return { valid: false, error: 'ID cannot be empty' };
  }

  const trimmed = id.trim();

  // Check for valid identifier format (starts with letter/underscore, alphanumeric)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return { valid: false, error: 'ID must start with a letter and contain only letters, numbers, and underscores' };
  }

  // Check for reserved keywords
  if (MERMAID_RESERVED.has(trimmed) || MERMAID_RESERVED.has(trimmed.toLowerCase())) {
    return { valid: false, error: `"${trimmed}" is a reserved Mermaid keyword` };
  }

  return { valid: true, id: trimmed };
}

// Prompt for a valid state ID with validation
function promptStateId(message) {
  while (true) {
    const input = prompt(message);
    if (input === null) return null; // User cancelled

    const validation = validateStateId(input);
    if (validation.valid) {
      return validation.id;
    }

    alert(`Invalid ID: ${validation.error}`);
  }
}

// Apply an edit with validation
async function applyEditWithValidation(newContent, description = 'edit') {
  const previousContent = currentContent;

  // Validate the new content first
  const validation = await validateMermaid(newContent);

  if (!validation.valid) {
    showError(`Invalid ${description}: ${validation.error}`);
    return false;
  }

  pushUndo(previousContent);
  currentContent = newContent;
  setEditorContent(currentContent);
  renderPreview();
  scheduleAutoSave();
  hideError();
  return true;
}

// Apply an edit to a specific line
async function applyLineEdit(lineIndex, newContent) {
  const lines = currentContent.split('\n');
  lines[lineIndex] = newContent;

  await applyEditWithValidation(lines.join('\n'), 'line edit');
}

// Delete a line from the source
async function deleteLine(lineIndex) {
  const lines = currentContent.split('\n');
  lines.splice(lineIndex, 1);

  await applyEditWithValidation(lines.join('\n'), 'delete');
}

// ============================================================================
// Node Context Menu
// ============================================================================

function showNodeContextMenu(x, y) {
  // Hide edge menu if open
  hideEdgeContextMenu();

  // Make visible to measure actual size
  nodeContextMenu.style.left = '-9999px';
  nodeContextMenu.style.top = '-9999px';
  nodeContextMenu.classList.add('visible');

  // Measure actual dimensions
  const menuWidth = nodeContextMenu.offsetWidth;
  const menuHeight = nodeContextMenu.offsetHeight;

  // Position menu, ensuring it stays within viewport
  const maxX = window.innerWidth - menuWidth - 10;
  const maxY = window.innerHeight - menuHeight - 10;

  nodeContextMenu.style.left = Math.max(10, Math.min(x, maxX)) + 'px';
  nodeContextMenu.style.top = Math.max(10, Math.min(y, maxY)) + 'px';
}

function hideNodeContextMenu() {
  nodeContextMenu.classList.remove('visible');
  currentNodeInfo = null;
}

// Handle click outside to close node menu
document.addEventListener('click', (e) => {
  // Don't hide/clear node info if we're in add transition mode
  if (!nodeContextMenu.contains(e.target) && !isAddingTransition) {
    hideNodeContextMenu();
  }
});

// Edit Description handler
nodeEditDesc.addEventListener('click', () => {
  if (!currentNodeInfo) return;

  const { nodeId, lineIndex, lineContent } = currentNodeInfo;

  // Extract current description from various formats:
  // NodeId[description] or NodeId(description) or NodeId{description}
  // state NodeId : description
  // participant NodeId as Alias
  let currentDesc = '';
  let descMatch;

  // Match bracket content: NodeId[desc], NodeId(desc), NodeId{desc}
  descMatch = lineContent.match(new RegExp(`${escapeRegex(nodeId)}\\s*[\\[\\(\\{]([^\\]\\)\\}]*)[\\]\\)\\}]`));
  if (descMatch) {
    currentDesc = descMatch[1];
  }

  // Match state description: state NodeId : desc  or  NodeId : desc
  if (!currentDesc) {
    descMatch = lineContent.match(new RegExp(`(?:state\\s+)?${escapeRegex(nodeId)}\\s*:\\s*(.+)$`));
    if (descMatch) {
      currentDesc = descMatch[1].trim();
    }
  }

  // Match participant alias: participant NodeId as Alias
  if (!currentDesc) {
    descMatch = lineContent.match(new RegExp(`(?:participant|actor)\\s+${escapeRegex(nodeId)}\\s+as\\s+(.+)$`, 'i'));
    if (descMatch) {
      currentDesc = descMatch[1].trim();
    }
  }

  const newDesc = prompt('Enter new description:', currentDesc);
  if (newDesc === null) {
    hideNodeContextMenu();
    return;
  }

  // Update the line with new description
  let newLine = lineContent;

  // Try to replace in brackets
  const bracketMatch = lineContent.match(new RegExp(`(${escapeRegex(nodeId)}\\s*)([\\[\\(\\{])([^\\]\\)\\}]*)([\\]\\)\\}])`));
  if (bracketMatch) {
    newLine = lineContent.replace(
      new RegExp(`(${escapeRegex(nodeId)}\\s*)([\\[\\(\\{])[^\\]\\)\\}]*([\\]\\)\\}])`),
      `$1$2${newDesc}$3`
    );
  }
  // Try to replace state description
  else if (lineContent.match(new RegExp(`(?:state\\s+)?${escapeRegex(nodeId)}\\s*:`))) {
    newLine = lineContent.replace(
      new RegExp(`((?:state\\s+)?${escapeRegex(nodeId)}\\s*:\\s*).+$`),
      `$1${newDesc}`
    );
  }
  // Try to replace participant alias
  else if (lineContent.match(new RegExp(`(?:participant|actor)\\s+${escapeRegex(nodeId)}\\s+as`, 'i'))) {
    newLine = lineContent.replace(
      new RegExp(`((?:participant|actor)\\s+${escapeRegex(nodeId)}\\s+as\\s+).+$`, 'i'),
      `$1${newDesc}`
    );
  }
  // If no format found, try to add brackets
  else if (newDesc.trim()) {
    newLine = lineContent.replace(
      new RegExp(`(^\\s*)(${escapeRegex(nodeId)})(\\s*)`),
      `$1$2[${newDesc}]$3`
    );
  }

  if (newLine !== lineContent) {
    applyLineEdit(lineIndex, newLine);
  }

  hideNodeContextMenu();
});

// Change Type handler
nodeChangeType.addEventListener('click', async () => {
  if (!currentNodeInfo) return;

  const { nodeId, lineIndex, lineContent } = currentNodeInfo;

  // Detect current type
  const currentType = detectNodeType(lineContent);

  // Extract current label - first try the current line, then search all lines
  let currentLabel = extractNodeLabel(lineContent, nodeId);

  if (!currentLabel) {
    // Search all lines for a definition of this node with a label
    const lines = currentContent.split('\n');
    for (const line of lines) {
      const label = extractNodeLabel(line, nodeId);
      if (label) {
        currentLabel = label;
        break;
      }
    }
  }

  // If still no label found, use the nodeId as fallback
  if (!currentLabel) {
    currentLabel = nodeId;
  }

  // Prompt for new type
  const newType = promptNodeType();
  if (newType === null) {
    hideNodeContextMenu();
    return;
  }

  // Create new node definition with the new type
  const newNodeDef = createNodeDefinition(nodeId, currentLabel, newType);

  const lines = currentContent.split('\n');

  // Check if the current line is a connection line (contains arrows)
  const isConnectionLine = /-->|==>|-\.->|---|->>|-->>|->/.test(lineContent);

  if (isConnectionLine) {
    // Don't replace connection lines - find or create a standalone definition
    // First, look for an existing standalone definition line
    let standaloneDefIndex = -1;
    const standalonePattern = new RegExp(`^\\s*${escapeRegex(nodeId)}\\s*[\\[\\(\\{]`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Must match the pattern AND not be a connection line
      if (standalonePattern.test(line) && !/-->|==>|-\.->|---|->>|-->>|->/.test(line)) {
        standaloneDefIndex = i;
        break;
      }
    }

    if (standaloneDefIndex !== -1) {
      // Update existing standalone definition
      lines[standaloneDefIndex] = newNodeDef;
    } else {
      // No standalone definition exists - add one after the diagram declaration
      // Find the first line after "graph/flowchart/stateDiagram"
      let insertIndex = 1;
      for (let i = 0; i < lines.length; i++) {
        if (/^(graph|flowchart|stateDiagram)/i.test(lines[i].trim())) {
          insertIndex = i + 1;
          break;
        }
      }
      // Skip any comments right after declaration
      while (insertIndex < lines.length && /^\s*%%/.test(lines[insertIndex])) {
        insertIndex++;
      }
      lines.splice(insertIndex, 0, newNodeDef);
    }
  } else {
    // It's a standalone definition line - update it directly
    lines[lineIndex] = newNodeDef;
  }

  let newContent = lines.join('\n');

  // Update the style for this node
  newContent = addStyleForNode(newContent, nodeId, newType);

  await applyEditWithValidation(newContent, 'change type');
  hideNodeContextMenu();
});

// Delete Node handler
nodeDelete.addEventListener('click', async () => {
  if (!currentNodeInfo) return;

  const { nodeId, lineIndex } = currentNodeInfo;

  // Find all lines that reference this node
  const lines = currentContent.split('\n');
  const referencingLines = [];
  const styleLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line contains this nodeId (as a word boundary)
    if (new RegExp(`\\b${escapeRegex(nodeId)}\\b`).test(line)) {
      referencingLines.push(i);
    }
    // Also check for style/class declarations for this node
    if (new RegExp(`^\\s*(style|class)\\s+${escapeRegex(nodeId)}\\b`).test(line)) {
      if (!referencingLines.includes(i)) {
        styleLines.push(i);
      }
    }
  }

  const allLinesToDelete = [...referencingLines, ...styleLines];
  const arrowCount = referencingLines.length - 1;
  const styleCount = styleLines.length;

  let message = `Delete node "${nodeId}"?`;
  if (arrowCount > 0 || styleCount > 0) {
    message += '\n\nThis will also delete:';
    if (arrowCount > 0) message += `\n- ${arrowCount} connected arrow(s)`;
    if (styleCount > 0) message += `\n- ${styleCount} style declaration(s)`;
  }

  if (confirm(message)) {
    const newLines = lines.filter((_, i) => !allLinesToDelete.includes(i));
    await applyEditWithValidation(newLines.join('\n'), 'delete node');
  }

  hideNodeContextMenu();
});

// Add Transition to Existing State handler
nodeAddTransition.addEventListener('click', () => {
  if (!currentNodeInfo) return;

  const label = prompt('Enter transition label (or leave empty for no label):');
  if (label === null) {
    hideNodeContextMenu();
    return;
  }

  // Store state for when user clicks destination
  pendingTransitionLabel = label;
  pendingSourceNode = currentNodeInfo.nodeId;

  // Hide menu but keep source node info
  nodeContextMenu.classList.remove('visible');

  // Enter "add transition" mode
  isAddingTransition = true;
  document.getElementById('mode-indicator-text').textContent = 'Click a destination state';
  modeIndicator.classList.add('visible');
  preview.style.cursor = 'crosshair';
});

// Handle clicking a destination when adding a transition
async function handleAddTransitionDestination(targetNodeId) {
  if (!isAddingTransition || !pendingSourceNode) return;

  // Create the transition line
  const source = pendingSourceNode;
  const target = targetNodeId;
  const label = pendingTransitionLabel;

  // Detect diagram type to use correct syntax
  const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

  let newLine;
  if (label.trim()) {
    if (isFlowchart) {
      // Flowchart syntax: A -->|label| B
      newLine = `    ${source} -->|${label}| ${target}`;
    } else {
      // State diagram syntax: A --> B : label
      newLine = `    ${source} --> ${target} : ${label}`;
    }
  } else {
    newLine = `    ${source} --> ${target}`;
  }

  // Find where to insert (after source node definition or at end of relevant section)
  const lines = currentContent.split('\n');
  let insertIndex = lines.length;

  // Try to find the source node line and insert after it
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^\\s*${escapeRegex(source)}\\b`).test(lines[i])) {
      insertIndex = i + 1;
      break;
    }
  }

  lines.splice(insertIndex, 0, newLine);

  const success = await applyEditWithValidation(lines.join('\n'), 'add transition');
  exitDestinationMode();
}

// Add Transition to New State handler
nodeAddTransitionNew.addEventListener('click', async () => {
  if (!currentNodeInfo) return;

  const label = prompt('Enter transition label (or leave empty for no label):');
  if (label === null) {
    hideNodeContextMenu();
    return;
  }

  const target = promptStateId('Enter node/state ID (e.g., NewState):');
  if (target === null) {
    hideNodeContextMenu();
    return;
  }

  const source = currentNodeInfo.nodeId;

  // Check if this state already exists in the diagram
  const stateExists = new RegExp(`\\b${escapeRegex(target)}\\b`).test(currentContent);

  let newStateLine = null;
  let nodeType = null;

  // Only ask for description and type if it's a NEW state
  if (!stateExists) {
    // Detect diagram type to use correct syntax
    const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

    if (isFlowchart) {
      // Ask for node type first
      nodeType = promptNodeType();
      if (nodeType === null) {
        hideNodeContextMenu();
        return;
      }

      const newStateDesc = prompt('Enter new node description (or leave empty):');
      if (newStateDesc === null) {
        hideNodeContextMenu();
        return;
      }

      // Create node definition with type
      newStateLine = createNodeDefinition(target, newStateDesc, nodeType);
    } else {
      // State diagram syntax (no type shapes)
      const newStateDesc = prompt('Enter new state description (or leave empty):');
      if (newStateDesc === null) {
        hideNodeContextMenu();
        return;
      }

      if (newStateDesc.trim()) {
        newStateLine = `    ${target} : ${newStateDesc}`;
      } else {
        newStateLine = `    ${target}`;
      }
    }
  }

  // Detect diagram type for transition syntax
  const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

  // Create transition line
  let transitionLine;
  if (isFlowchart) {
    if (label.trim()) {
      transitionLine = `    ${source} -->|${label}| ${target}`;
    } else {
      transitionLine = `    ${source} --> ${target}`;
    }
  } else {
    if (label.trim()) {
      transitionLine = `    ${source} --> ${target} : ${label}`;
    } else {
      transitionLine = `    ${source} --> ${target}`;
    }
  }

  // Find where to insert
  let lines = currentContent.split('\n');
  let insertIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^\\s*${escapeRegex(source)}\\b`).test(lines[i])) {
      insertIndex = i + 1;
      break;
    }
  }

  // Insert transition, and new node definition only if state is new
  if (newStateLine) {
    lines.splice(insertIndex, 0, transitionLine, newStateLine);
  } else {
    lines.splice(insertIndex, 0, transitionLine);
  }

  let newContent = lines.join('\n');

  // Add style for new node if we created one with a type
  if (nodeType && newStateLine) {
    newContent = addStyleForNode(newContent, target, nodeType);
  }

  await applyEditWithValidation(newContent, 'add transition');
  hideNodeContextMenu();
});

// Change Origin to New State handler (for edges)
edgeChangeOriginNew.addEventListener('click', async () => {
  if (!currentEdgeInfo) return;

  const newSource = promptStateId('Enter new state ID (e.g., NewState):');
  if (newSource === null) {
    hideEdgeContextMenu();
    return;
  }

  const { lineIndex, lineContent, source, target } = currentEdgeInfo;

  // Check if this state already exists in the diagram
  const stateExists = new RegExp(`\\b${escapeRegex(newSource)}\\b`).test(currentContent);

  let newStateLine = null;
  let nodeType = null;

  // Only ask for description and type if it's a NEW state
  if (!stateExists) {
    // Detect diagram type to use correct syntax
    const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

    if (isFlowchart) {
      // Ask for node type first
      nodeType = promptNodeType();
      if (nodeType === null) {
        hideEdgeContextMenu();
        return;
      }

      const newStateDesc = prompt('Enter new node description (or leave empty):');
      if (newStateDesc === null) {
        hideEdgeContextMenu();
        return;
      }

      // Create node definition with type
      newStateLine = createNodeDefinition(newSource, newStateDesc, nodeType);
    } else {
      // State diagram syntax (no type shapes)
      const newStateDesc = prompt('Enter new state description (or leave empty):');
      if (newStateDesc === null) {
        hideEdgeContextMenu();
        return;
      }

      if (newStateDesc.trim()) {
        newStateLine = `    ${newSource} : ${newStateDesc}`;
      } else {
        newStateLine = `    ${newSource}`;
      }
    }
  }

  // Update the transition to use new source
  let newTransitionLine = lineContent;

  // Try to replace source with newSource (first occurrence)
  const sourceRegex = new RegExp(`\\b${escapeRegex(source)}\\b`);
  if (sourceRegex.test(lineContent)) {
    const firstIndex = lineContent.indexOf(source);
    if (firstIndex !== -1) {
      newTransitionLine = lineContent.substring(0, firstIndex) + newSource + lineContent.substring(firstIndex + source.length);
    }
  }

  let lines = currentContent.split('\n');

  // Update the transition line
  lines[lineIndex] = newTransitionLine;

  // Insert new state definition before the transition if state is new
  if (newStateLine) {
    lines.splice(lineIndex, 0, newStateLine);
  }

  let newContent = lines.join('\n');

  // Add style for new node if we created one with a type
  if (nodeType && newStateLine) {
    newContent = addStyleForNode(newContent, newSource, nodeType);
  }

  await applyEditWithValidation(newContent, 'change origin');
  hideEdgeContextMenu();
});

// Change Destination to New State handler (for edges)
edgeChangeDestNew.addEventListener('click', async () => {
  if (!currentEdgeInfo) return;

  const newTarget = promptStateId('Enter new state ID (e.g., NewState):');
  if (newTarget === null) {
    hideEdgeContextMenu();
    return;
  }

  const { lineIndex, lineContent, source, target } = currentEdgeInfo;

  // Check if this state already exists in the diagram
  const stateExists = new RegExp(`\\b${escapeRegex(newTarget)}\\b`).test(currentContent);

  let newStateLine = null;
  let nodeType = null;

  // Only ask for description and type if it's a NEW state
  if (!stateExists) {
    // Detect diagram type to use correct syntax
    const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

    if (isFlowchart) {
      // Ask for node type first
      nodeType = promptNodeType();
      if (nodeType === null) {
        hideEdgeContextMenu();
        return;
      }

      const newStateDesc = prompt('Enter new node description (or leave empty):');
      if (newStateDesc === null) {
        hideEdgeContextMenu();
        return;
      }

      // Create node definition with type
      newStateLine = createNodeDefinition(newTarget, newStateDesc, nodeType);
    } else {
      // State diagram syntax (no type shapes)
      const newStateDesc = prompt('Enter new state description (or leave empty):');
      if (newStateDesc === null) {
        hideEdgeContextMenu();
        return;
      }

      if (newStateDesc.trim()) {
        newStateLine = `    ${newTarget} : ${newStateDesc}`;
      } else {
        newStateLine = `    ${newTarget}`;
      }
    }
  }

  // Update the transition to point to new state
  // Use word boundary replacement to handle various formats
  let newTransitionLine = lineContent;

  // Try to replace target with newTarget (with word boundary)
  const targetRegex = new RegExp(`\\b${escapeRegex(target)}\\b`);
  if (targetRegex.test(lineContent)) {
    // Find the last occurrence of target (it's the destination)
    const lastIndex = lineContent.lastIndexOf(target);
    if (lastIndex !== -1) {
      newTransitionLine = lineContent.substring(0, lastIndex) + newTarget + lineContent.substring(lastIndex + target.length);
    }
  }

  let lines = currentContent.split('\n');

  // Update the transition line
  lines[lineIndex] = newTransitionLine;

  // Only insert new state definition if state doesn't already exist
  if (newStateLine) {
    lines.splice(lineIndex + 1, 0, newStateLine);
  }

  let newContent = lines.join('\n');

  // Add style for new node if we created one with a type
  if (nodeType && newStateLine) {
    newContent = addStyleForNode(newContent, newTarget, nodeType);
  }

  await applyEditWithValidation(newContent, 'change destination');
  hideEdgeContextMenu();
});

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
  scheduleAutoSave();
}

function redo() {
  if (redoStack.length === 0) return;

  const content = redoStack.pop();
  undoStack.push(content);
  currentContent = content;
  setEditorContent(currentContent);
  renderPreview();
  updateUndoRedoButtons();
  scheduleAutoSave();
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
    e.preventDefault(); // Prevent text selection while resizing
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

  // Also cleanup on blur/mouseleave in case mouseup is missed
  window.addEventListener('blur', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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

// Format/organize Mermaid code
function formatMermaidCode() {
  const lines = currentContent.split('\n');

  // Detect diagram type
  const firstLine = lines.find(l => l.trim().length > 0) || '';
  const isFlowchart = /^(graph|flowchart)\s/i.test(firstLine);
  const isStateDiagram = /^stateDiagram/i.test(firstLine);
  const isSequence = /^sequenceDiagram/i.test(firstLine);

  if (!isFlowchart && !isStateDiagram) {
    showError('Format is only supported for flowcharts and state diagrams');
    setTimeout(hideError, 3000);
    return;
  }

  // Collect all node definitions (nodeId -> {label, type, fullDef})
  // First definition wins for label
  const nodeInfo = new Map();

  // Helper to extract node info from a string containing a node definition
  function extractNodeInfo(str) {
    // Patterns: NodeId(["label"]), NodeId(("label")), NodeId{"label"}, NodeId["label"], NodeId[label]
    const patterns = [
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\(\["([^"]+)"\]\)/, type: 'terminal' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\(\[([^\]]+)\]\)/, type: 'terminal' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\(\("([^"]+)"\)\)/, type: 'state' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\(\(([^)]+)\)\)/, type: 'state' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\{"([^"]+)"\}/, type: 'decision' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]+)\}/, type: 'decision' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\["([^"]+)"\]/, type: 'action' },
      { regex: /([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\]]+)\]/, type: 'action' },
    ];

    const results = [];
    for (const { regex, type } of patterns) {
      let match;
      const globalRegex = new RegExp(regex.source, 'g');
      while ((match = globalRegex.exec(str)) !== null) {
        results.push({ nodeId: match[1], label: match[2], type });
      }
    }
    return results;
  }

  // Helper to strip inline node definitions from a connection, keeping just node IDs
  function stripInlineDefinitions(connLine) {
    // Replace NodeId[...], NodeId(...), NodeId{...} with just NodeId
    // But preserve edge labels like |text|
    let result = connLine;

    // Strip terminal: NodeId(["..."]) or NodeId([...])
    result = result.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\(\[(?:"[^"]*"|[^\]]*)\]\)/g, '$1');
    // Strip state: NodeId(("...")) or NodeId((...))
    result = result.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\(\((?:"[^"]*"|[^)]*)\)\)/g, '$1');
    // Strip decision: NodeId{"..."} or NodeId{...}
    result = result.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\{(?:"[^"]*"|[^}]*)\}/g, '$1');
    // Strip action: NodeId["..."] or NodeId[...]
    result = result.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*\[(?:"[^"]*"|[^\]]*)\]/g, '$1');

    return result;
  }

  // Categorize lines
  const declaration = [];      // graph TD, stateDiagram-v2, etc.
  const comments = [];         // %% comments at the top
  const connections = [];      // A --> B, transitions (will be cleaned)
  const subgraphs = [];        // subgraph blocks (kept together)
  const styles = [];           // style, classDef, class
  const other = [];            // anything else

  let inSubgraph = false;
  let subgraphLines = [];
  let subgraphDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines (we'll add our own spacing)
    if (!trimmed) continue;

    // Handle subgraphs (keep them as blocks)
    if (/^subgraph\b/i.test(trimmed)) {
      inSubgraph = true;
      subgraphDepth++;
      subgraphLines.push(line);
      continue;
    }

    if (inSubgraph) {
      subgraphLines.push(line);
      if (/^end\s*$/i.test(trimmed)) {
        subgraphDepth--;
        if (subgraphDepth === 0) {
          inSubgraph = false;
          subgraphs.push(subgraphLines.join('\n'));
          subgraphLines = [];
        }
      }
      continue;
    }

    // Extract any node definitions from this line (standalone or inline)
    const nodesInLine = extractNodeInfo(trimmed);
    for (const { nodeId, label, type } of nodesInLine) {
      // First definition wins
      if (!nodeInfo.has(nodeId)) {
        nodeInfo.set(nodeId, { label, type });
      }
    }

    // Categorize the line
    if (/^(graph|flowchart|stateDiagram)/i.test(trimmed)) {
      declaration.push(trimmed);
    }
    else if (/~~~/.test(trimmed)) {
      // Skip invisible links - we regenerate them
      continue;
    }
    else if (/^%%/.test(trimmed)) {
      // Skip section header comments we regenerate
      if (/^%%\s*(Node Definitions|Connections|Styles|Subgraphs)/i.test(trimmed)) {
        continue;
      }
      comments.push(trimmed);
    }
    else if (/^(style|classDef|class)\s/i.test(trimmed)) {
      styles.push('    ' + trimmed.replace(/^\s+/, ''));
    }
    else if (/^(click)\s/i.test(trimmed)) {
      other.push('    ' + trimmed.replace(/^\s+/, ''));
    }
    // Connection patterns: -->, ==>, -.->  etc.
    else if (/-->|==>|--[->]|-\.->|--x|--o|<-->|<-.->|\s:\s/.test(trimmed)) {
      // Strip inline definitions, keep just node IDs
      const cleanedConn = stripInlineDefinitions(trimmed);
      connections.push('    ' + cleanedConn.replace(/^\s+/, ''));
    }
    // Standalone node definitions - skip them, we'll regenerate from nodeInfo
    else if (/^[A-Za-z_][A-Za-z0-9_]*\s*[\[\(\{]/.test(trimmed) ||
             /^state\s+/i.test(trimmed)) {
      // Already extracted above, skip
      continue;
    }
    // Plain node ID without definition - record it exists
    else if (/^[A-Za-z_][A-Za-z0-9_]*\s*$/.test(trimmed)) {
      const nodeId = trimmed.trim();
      if (!nodeInfo.has(nodeId)) {
        nodeInfo.set(nodeId, { label: nodeId, type: 'action' });
      }
    }
    else {
      other.push('    ' + trimmed.replace(/^\s+/, ''));
    }
  }

  // Find root node and build adjacency for BFS
  const sourceNodes = new Set();
  const targetNodes = new Set();
  const outgoingCount = new Map();
  const adjacency = new Map();

  for (const conn of connections) {
    const trimmed = conn.trim();
    const arrowMatch = trimmed.match(/(-->|==>|-\.->|---|->>|-->>|->)/);
    if (arrowMatch) {
      const parts = trimmed.split(arrowMatch[1]);
      if (parts.length >= 2) {
        const sourceMatch = parts[0].match(/([A-Za-z_][A-Za-z0-9_]*)/);
        const rightSide = parts[1].replace(/^\s*\|[^|]*\|\s*/, '');
        const targetMatch = rightSide.match(/([A-Za-z_][A-Za-z0-9_]*)/);
        if (sourceMatch && targetMatch) {
          const source = sourceMatch[1];
          const target = targetMatch[1];
          sourceNodes.add(source);
          targetNodes.add(target);
          outgoingCount.set(source, (outgoingCount.get(source) || 0) + 1);
          if (!adjacency.has(source)) adjacency.set(source, []);
          adjacency.get(source).push(target);

          // Ensure nodes in connections have entries in nodeInfo
          if (!nodeInfo.has(source)) {
            nodeInfo.set(source, { label: source, type: 'action' });
          }
          if (!nodeInfo.has(target)) {
            nodeInfo.set(target, { label: target, type: 'action' });
          }
        }
      }
    }
  }

  // Root nodes are sources that are never targets
  let rootNodes = [...sourceNodes].filter(n => !targetNodes.has(n));

  // Prioritize: 1) node named "Root", 2) node with most outgoing edges
  if (rootNodes.length > 1) {
    const namedRoot = rootNodes.find(n => n.toLowerCase() === 'root');
    if (namedRoot) {
      rootNodes = [namedRoot];
    } else {
      rootNodes.sort((a, b) => (outgoingCount.get(b) || 0) - (outgoingCount.get(a) || 0));
      rootNodes = [rootNodes[0]];
    }
  }

  // BFS to assign levels (distance from root)
  const nodeLevels = new Map();
  const root = rootNodes[0] || [...sourceNodes][0];

  if (root) {
    const queue = [[root, 0]];
    nodeLevels.set(root, 0);

    while (queue.length > 0) {
      const [node, level] = queue.shift();
      const targets = adjacency.get(node) || [];
      for (const target of targets) {
        if (!nodeLevels.has(target)) {
          nodeLevels.set(target, level + 1);
          queue.push([target, level + 1]);
        }
      }
    }
  }

  // Assign high level to disconnected nodes
  const maxLevel = Math.max(...nodeLevels.values(), 0);
  for (const nodeId of nodeInfo.keys()) {
    if (!nodeLevels.has(nodeId)) {
      nodeLevels.set(nodeId, maxLevel + 1);
    }
  }

  // Generate node definitions from nodeInfo
  const nodeDefinitions = [];
  for (const [nodeId, info] of nodeInfo.entries()) {
    const def = createNodeDefinition(nodeId, info.label, info.type);
    nodeDefinitions.push(def);
  }

  // Get node ID from a definition line
  const getNodeId = (line) => line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';

  // Sort node definitions by level, then alphabetically
  nodeDefinitions.sort((a, b) => {
    const idA = getNodeId(a);
    const idB = getNodeId(b);
    const levelA = nodeLevels.get(idA) ?? 999;
    const levelB = nodeLevels.get(idB) ?? 999;

    if (levelA !== levelB) return levelA - levelB;
    return idA.localeCompare(idB);
  });

  // Sort connections by source level, then alphabetically
  connections.sort((a, b) => {
    const idA = getNodeId(a);
    const idB = getNodeId(b);
    const levelA = nodeLevels.get(idA) ?? 999;
    const levelB = nodeLevels.get(idB) ?? 999;

    if (levelA !== levelB) return levelA - levelB;
    return idA.localeCompare(idB);
  });

  // Sort styles by node level, then alphabetically
  styles.sort((a, b) => {
    const idA = a.trim().match(/^(?:style|class)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';
    const idB = b.trim().match(/^(?:style|class)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';
    const levelA = nodeLevels.get(idA) ?? 999;
    const levelB = nodeLevels.get(idB) ?? 999;

    if (levelA !== levelB) return levelA - levelB;
    return idA.localeCompare(idB);
  });

  // Generate styles for all nodes based on their types
  const generatedStyles = [];
  for (const [nodeId, info] of nodeInfo.entries()) {
    const typeConfig = NODE_TYPES[info.type];
    if (typeConfig) {
      generatedStyles.push(`    style ${nodeId} ${typeConfig.style}`);
    }
  }

  // Sort generated styles by level
  generatedStyles.sort((a, b) => {
    const idA = a.trim().match(/^style\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';
    const idB = b.trim().match(/^style\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || '';
    const levelA = nodeLevels.get(idA) ?? 999;
    const levelB = nodeLevels.get(idB) ?? 999;

    if (levelA !== levelB) return levelA - levelB;
    return idA.localeCompare(idB);
  });

  // Merge styles: use generated styles, but keep any custom styles (classDef, class)
  const customStyles = styles.filter(s => !/^\s*style\s+/i.test(s));
  const allStyles = [...generatedStyles, ...customStyles];

  // Build formatted output
  const sections = [];

  // Declaration
  if (declaration.length > 0) {
    sections.push(declaration.join('\n'));
  }

  // Comments (at top, after declaration)
  if (comments.length > 0) {
    sections.push(comments.map(c => '    ' + c).join('\n'));
  }

  // Node definitions
  if (nodeDefinitions.length > 0) {
    sections.push('    %% Node Definitions');
    sections.push(nodeDefinitions.join('\n'));
  }

  // Connections
  if (connections.length > 0) {
    sections.push('    %% Connections');
    sections.push(connections.join('\n'));
  }

  // Existing subgraphs from original content
  if (subgraphs.length > 0) {
    sections.push('    %% Subgraphs');
    sections.push(subgraphs.join('\n\n'));
  }

  // Other
  if (other.length > 0) {
    sections.push(other.join('\n'));
  }

  // Styles (at the end) - use generated styles based on node types
  if (allStyles.length > 0) {
    sections.push('    %% Styles');
    sections.push(allStyles.join('\n'));
  }

  const formatted = sections.join('\n\n');

  // Apply the formatted content
  pushUndo(currentContent);
  currentContent = formatted;
  setEditorContent(currentContent);
  renderPreview();
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
formatCodeBtn.addEventListener('click', formatMermaidCode);

// Create New Node button handler
createNodeBtn.addEventListener('click', async () => {
  // Prompt for node ID
  const nodeId = promptStateId('Enter new node ID (e.g., MyNode):');
  if (nodeId === null) return;

  // Check if node already exists
  const nodeExists = new RegExp(`\\b${escapeRegex(nodeId)}\\b`).test(currentContent);
  if (nodeExists) {
    showError(`Node "${nodeId}" already exists in the diagram`);
    setTimeout(hideError, 3000);
    return;
  }

  // Detect diagram type
  const isFlowchart = /^(graph|flowchart)\s/m.test(currentContent);

  let newNodeLine;
  let nodeType = null;

  if (isFlowchart) {
    // Ask for node type
    nodeType = promptNodeType();
    if (nodeType === null) return;

    // Ask for description
    const nodeDesc = prompt('Enter node description (or leave empty):');
    if (nodeDesc === null) return;

    newNodeLine = createNodeDefinition(nodeId, nodeDesc || nodeId, nodeType);
  } else {
    // State diagram syntax
    const nodeDesc = prompt('Enter state description (or leave empty):');
    if (nodeDesc === null) return;

    if (nodeDesc.trim()) {
      newNodeLine = `    ${nodeId} : ${nodeDesc}`;
    } else {
      newNodeLine = `    ${nodeId}`;
    }
  }

  // Find where to insert the node definition
  const lines = currentContent.split('\n');
  let insertIndex = 1;

  // Look for %% Node Definitions section
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*%%\s*Node Definitions/i.test(lines[i])) {
      // Insert after this comment, find the end of node definitions
      insertIndex = i + 1;
      while (insertIndex < lines.length) {
        const line = lines[insertIndex].trim();
        // Stop at next section comment or connection
        if (/^%%/.test(line) || /-->|==>|-\.->/.test(line)) {
          break;
        }
        insertIndex++;
      }
      break;
    }
    // Or after diagram declaration if no section found
    if (/^(graph|flowchart|stateDiagram)/i.test(lines[i].trim())) {
      insertIndex = i + 1;
    }
  }

  lines.splice(insertIndex, 0, newNodeLine);
  let newContent = lines.join('\n');

  // Add style for the new node
  if (nodeType) {
    newContent = addStyleForNode(newContent, nodeId, nodeType);
  }

  await applyEditWithValidation(newContent, 'create node');
});

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
    // Re-render preview with new Mermaid theme
    renderPreview();
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
  // Re-render preview with new Mermaid theme
  renderPreview();
});

// Initialize
initTheme();
initResizer();
api.connectWebSocket();
loadDiagram();
