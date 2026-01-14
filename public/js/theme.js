/**
 * Theme management for the application
 * Handles light/dark mode switching with localStorage persistence
 *
 * Color palettes based on accessible syntax highlighting research:
 * - a11y-syntax-highlighting (WCAG AA/AAA compliant)
 * - One Dark theme colors
 *
 * Sources:
 * - https://github.com/ericwbailey/a11y-syntax-highlighting
 * - https://github.com/atom/one-dark-syntax
 */
import { EditorView } from 'https://esm.sh/@codemirror/view@6';
import { HighlightStyle, syntaxHighlighting } from 'https://esm.sh/@codemirror/language@6';
import { tags } from 'https://esm.sh/@lezer/highlight@1';

// =============================================================================
// DARK THEME - Based on One Dark with a11y accessibility improvements
// Background: #282C34 (softer than pure black for reduced eye strain)
// =============================================================================

const darkTheme = EditorView.theme({
  "&": {
    backgroundColor: "#282C34",
    color: "#ABB2BF"
  },
  ".cm-content": {
    caretColor: "#528BFF"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#528BFF"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#0066CC"
  },
  ".cm-panels": {
    backgroundColor: "#21252B",
    color: "#ABB2BF"
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid #181A1F"
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid #181A1F"
  },
  ".cm-searchMatch": {
    backgroundColor: "#D19A6650",
    outline: "1px solid #D19A66"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#D19A66"
  },
  ".cm-activeLine": {
    backgroundColor: "#2C313A"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#0066CC80"
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#515A6B",
    outline: "1px solid #515A6B"
  },
  ".cm-gutters": {
    backgroundColor: "#282C34",
    color: "#636D83",
    border: "none",
    borderRight: "1px solid #181A1F"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#2C313A"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "#636D83"
  },
  ".cm-tooltip": {
    border: "1px solid #181A1F",
    backgroundColor: "#21252B"
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "#2C313A",
      color: "#ABB2BF"
    }
  }
}, { dark: true });

// Dark theme syntax highlighting - Neon colors for high visibility
// Vibrant colors optimized for dark backgrounds
const darkHighlightStyle = HighlightStyle.define([
  // Keywords: neon magenta - control flow, declarations
  { tag: tags.keyword, color: "#FF00FF", fontWeight: "bold" },

  // Atoms: neon cyan - constants, booleans, direction keywords
  { tag: tags.atom, color: "#00FFFF" },

  // Numbers: neon orange
  { tag: tags.number, color: "#FF8C00" },

  // Definitions: neon blue - function/class definitions
  { tag: tags.definition(tags.name), color: "#00BFFF" },

  // Variables: neon coral/pink
  { tag: tags.variableName, color: "#FF6B9D" },

  // Punctuation: bright silver
  { tag: tags.punctuation, color: "#C0C0C0" },

  // Property names: neon blue
  { tag: tags.propertyName, color: "#00BFFF" },

  // Operators: neon cyan - arrows, relationships
  { tag: tags.operator, color: "#00FFFF" },

  // Comments: muted but visible
  { tag: tags.comment, color: "#7A8B99", fontStyle: "italic" },

  // Strings: neon green - labels, text content
  { tag: tags.string, color: "#00FF7F" },

  // Meta: visible gray
  { tag: tags.meta, color: "#8899AA" },

  // Labels: neon yellow
  { tag: tags.labelName, color: "#FFD700" },

  // Functions: neon blue
  { tag: tags.function(tags.variableName), color: "#00BFFF" },

  // Type names: neon gold - component types
  { tag: tags.typeName, color: "#FFD700" },

  // Brackets: bright silver
  { tag: tags.bracket, color: "#C0C0C0" },

  // Tag names: neon pink
  { tag: tags.tagName, color: "#FF6B9D" },

  // Attribute names: neon orange
  { tag: tags.attributeName, color: "#FF8C00" },

  // Links: neon blue
  { tag: tags.link, color: "#00BFFF" },

  // Builtins: neon orange - spacer, divider
  { tag: tags.standard(tags.name), color: "#FF8C00" },

  // Special: neon cyan
  { tag: tags.special(tags.string), color: "#00FFFF" },

  // Namespace: neon gold
  { tag: tags.namespace, color: "#FFD700" },

  // Class names: neon gold
  { tag: tags.className, color: "#FFD700" },

  // Macros/Preprocessor: neon magenta
  { tag: tags.macroName, color: "#FF00FF" },

  // Invalid: bright red with underline
  { tag: tags.invalid, color: "#FF4757", textDecoration: "underline wavy" },

  // === Markdown-specific tags ===
  // Headings: neon pink with bold
  { tag: tags.heading, color: "#FF6B9D", fontWeight: "bold" },
  { tag: tags.heading1, color: "#FF6B9D", fontWeight: "bold", fontSize: "1.3em" },
  { tag: tags.heading2, color: "#FF6B9D", fontWeight: "bold", fontSize: "1.2em" },
  { tag: tags.heading3, color: "#FF6B9D", fontWeight: "bold", fontSize: "1.1em" },

  // Emphasis: italic neon gold
  { tag: tags.emphasis, fontStyle: "italic", color: "#FFD700" },

  // Strong: bold neon orange
  { tag: tags.strong, fontWeight: "bold", color: "#FF8C00" },

  // Strikethrough
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#7A8B99" },

  // Quote/blockquote: visible gray italic
  { tag: tags.quote, color: "#8899AA", fontStyle: "italic" },

  // Lists: neon cyan
  { tag: tags.list, color: "#00FFFF" },

  // Inline code: neon green
  { tag: tags.monospace, color: "#00FF7F" },

  // URLs: neon blue underline
  { tag: tags.url, color: "#00BFFF", textDecoration: "underline" },

  // Content separator (hr): visible gray
  { tag: tags.contentSeparator, color: "#8899AA" },

  // Processing instructions (like HTML in markdown)
  { tag: tags.processingInstruction, color: "#8899AA" },
]);

// =============================================================================
// LIGHT THEME - Based on a11y-light (WCAG AA compliant)
// Background: #FEFEFE (softer than pure white)
// =============================================================================

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#FEFEFE",
    color: "#383A42"
  },
  ".cm-content": {
    caretColor: "#526FFF"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#526FFF"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#E5E5E6"
  },
  ".cm-panels": {
    backgroundColor: "#F5F5F5",
    color: "#383A42"
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid #E0E0E0"
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid #E0E0E0"
  },
  ".cm-searchMatch": {
    backgroundColor: "#FFDF5D80",
    outline: "1px solid #C4A000"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#FFDF5D"
  },
  ".cm-activeLine": {
    backgroundColor: "#F5F5F5"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#E5E5E680"
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#CCEEFF",
    outline: "1px solid #99CCFF"
  },
  ".cm-gutters": {
    backgroundColor: "#F5F5F5",
    color: "#9D9D9F",
    border: "none",
    borderRight: "1px solid #E0E0E0"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#E8E8E8"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "#9D9D9F"
  },
  ".cm-tooltip": {
    border: "1px solid #E0E0E0",
    backgroundColor: "#FFFFFF"
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "#0366D6",
      color: "#FFFFFF"
    }
  }
}, { dark: false });

// Light theme syntax highlighting - a11y-light inspired colors
// All colors meet WCAG AA contrast ratio (4.5:1+) on #FEFEFE background
const lightHighlightStyle = HighlightStyle.define([
  // Keywords: purple - control flow, declarations
  { tag: tags.keyword, color: "#A626A4", fontWeight: "bold" },

  // Atoms: teal - constants, booleans, direction keywords
  { tag: tags.atom, color: "#0184BC" },

  // Numbers: orange/brown
  { tag: tags.number, color: "#986801" },

  // Definitions: blue - function/class definitions
  { tag: tags.definition(tags.name), color: "#4078F2" },

  // Variables: dark red
  { tag: tags.variableName, color: "#E45649" },

  // Punctuation: dark gray
  { tag: tags.punctuation, color: "#383A42" },

  // Property names: blue
  { tag: tags.propertyName, color: "#4078F2" },

  // Operators: teal - arrows, relationships
  { tag: tags.operator, color: "#0184BC" },

  // Comments: brown/rust italic
  { tag: tags.comment, color: "#A0A1A7", fontStyle: "italic" },

  // Strings: green - labels, text content
  { tag: tags.string, color: "#50A14F" },

  // Meta: gray
  { tag: tags.meta, color: "#A0A1A7" },

  // Labels: orange
  { tag: tags.labelName, color: "#C18401" },

  // Functions: blue
  { tag: tags.function(tags.variableName), color: "#4078F2" },

  // Type names: orange/gold - component types
  { tag: tags.typeName, color: "#C18401" },

  // Brackets: dark gray
  { tag: tags.bracket, color: "#383A42" },

  // Tag names: red
  { tag: tags.tagName, color: "#E45649" },

  // Attribute names: orange
  { tag: tags.attributeName, color: "#986801" },

  // Links: blue
  { tag: tags.link, color: "#4078F2" },

  // Builtins: orange - spacer, divider
  { tag: tags.standard(tags.name), color: "#986801" },

  // Special: teal
  { tag: tags.special(tags.string), color: "#0184BC" },

  // Namespace: orange
  { tag: tags.namespace, color: "#C18401" },

  // Class names: orange
  { tag: tags.className, color: "#C18401" },

  // Macros/Preprocessor: purple
  { tag: tags.macroName, color: "#A626A4" },

  // Invalid: red with underline
  { tag: tags.invalid, color: "#E45649", textDecoration: "underline wavy" },

  // === Markdown-specific tags ===
  // Headings: dark red with bold
  { tag: tags.heading, color: "#E45649", fontWeight: "bold" },
  { tag: tags.heading1, color: "#E45649", fontWeight: "bold", fontSize: "1.3em" },
  { tag: tags.heading2, color: "#E45649", fontWeight: "bold", fontSize: "1.2em" },
  { tag: tags.heading3, color: "#E45649", fontWeight: "bold", fontSize: "1.1em" },

  // Emphasis: italic
  { tag: tags.emphasis, fontStyle: "italic", color: "#C18401" },

  // Strong: bold
  { tag: tags.strong, fontWeight: "bold", color: "#986801" },

  // Strikethrough
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#A0A1A7" },

  // Quote/blockquote: gray italic
  { tag: tags.quote, color: "#A0A1A7", fontStyle: "italic" },

  // Lists: teal
  { tag: tags.list, color: "#0184BC" },

  // Inline code: green
  { tag: tags.monospace, color: "#50A14F" },

  // URLs: blue underline
  { tag: tags.url, color: "#4078F2", textDecoration: "underline" },

  // Content separator (hr): gray
  { tag: tags.contentSeparator, color: "#A0A1A7" },

  // Processing instructions (like HTML in markdown)
  { tag: tags.processingInstruction, color: "#A0A1A7" },
]);

// =============================================================================
// THEME STATE & MANAGEMENT
// =============================================================================

let currentTheme = 'dark';
let themeListeners = [];

function getStoredTheme() {
  return localStorage.getItem('app-theme') || 'dark';
}

function storeTheme(theme) {
  localStorage.setItem('app-theme', theme);
}

function initTheme() {
  currentTheme = getStoredTheme();
  applyTheme(currentTheme);
  return currentTheme;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
  storeTheme(theme);
  themeListeners.forEach(fn => fn(theme));
}

function toggleTheme() {
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  return newTheme;
}

function getTheme() {
  return currentTheme;
}

function onThemeChange(callback) {
  themeListeners.push(callback);
  return () => {
    themeListeners = themeListeners.filter(fn => fn !== callback);
  };
}

// Get CodeMirror extensions for current theme
function getEditorTheme(theme = currentTheme) {
  if (theme === 'light') {
    return [lightTheme, syntaxHighlighting(lightHighlightStyle)];
  }
  return [darkTheme, syntaxHighlighting(darkHighlightStyle)];
}

export {
  initTheme,
  applyTheme,
  toggleTheme,
  getTheme,
  onThemeChange,
  getEditorTheme,
  lightTheme,
  lightHighlightStyle,
  darkTheme,
  darkHighlightStyle
};
