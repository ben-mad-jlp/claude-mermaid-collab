/**
 * CodeMirror 6 language support for Wireframe diagrams
 *
 * Token types use StreamLanguage legacy mappings:
 * - keyword → tags.keyword (purple) - wireframe, screen
 * - atom → tags.atom (cyan) - viewport, direction, variants
 * - type → tags.typeName (yellow/orange) - container components
 * - def → tags.definition (blue) - UI components
 * - builtin → tags.standard (orange) - utilities
 * - property → tags.propertyName (blue) - modifiers
 * - string → tags.string (green) - labels
 * - number → tags.number (orange) - values
 * - operator → tags.operator (cyan) - equals
 * - punctuation → tags.punctuation - pipe separators
 * - comment → tags.comment (gray) - comments
 */
import { StreamLanguage } from 'https://esm.sh/@codemirror/language@6.10.0';

const wireframeLanguage = StreamLanguage.define({
  token(stream, state) {
    // Skip whitespace at start of line (but track indentation)
    if (stream.sol()) {
      state.indent = stream.indentation();
    }

    // Comments
    if (stream.match(/%%/)) {
      stream.skipToEnd();
      return 'comment';
    }

    // Strings (labels in quotes)
    if (stream.match(/"[^"]*"/)) {
      return 'string';
    }

    // Wireframe declaration
    if (stream.sol() && stream.match(/wireframe\b/)) {
      return 'keyword';
    }

    // Viewport keywords
    if (stream.match(/\b(mobile|tablet|desktop)\b/)) {
      return 'atom';
    }

    // Direction keywords
    if (stream.match(/\b(TD|LR)\b/)) {
      return 'atom';
    }

    // Screen keyword
    if (stream.match(/\bscreen\b/)) {
      return 'keyword';
    }

    // Container components (type → tags.typeName)
    if (stream.match(/\b(col|row|Card|Grid)\b/)) {
      return 'type';
    }

    // Navigation components (def → tags.definition)
    if (stream.match(/\b(AppBar|NavMenu|BottomNav|FAB)\b/)) {
      return 'def';
    }

    // Form input components (def → tags.definition)
    if (stream.match(/\b(Input|Checkbox|Radio|Switch|Dropdown|Button)\b/)) {
      return 'def';
    }

    // Display components (def → tags.definition)
    if (stream.match(/\b(Text|Title|Avatar|Icon|Image|List)\b/)) {
      return 'def';
    }

    // Layout utilities (builtin → tags.standard)
    if (stream.match(/\b(spacer|divider)\b/)) {
      return 'builtin';
    }

    // Grid keywords
    if (stream.match(/\b(header|row)\b(?=\s*")/)) {
      return 'keyword';
    }

    // Button/appearance variants
    if (stream.match(/\b(primary|secondary|danger|success|disabled)\b/)) {
      return 'atom';
    }

    // Alignment values
    if (stream.match(/\b(start|center|end|space-between)\b/)) {
      return 'atom';
    }

    // Layout modifiers (property → tags.propertyName)
    if (stream.match(/\b(flex|width|height|padding|align|cross)\b(?=\s*=)/)) {
      return 'property';
    }

    // Standalone flex modifier
    if (stream.match(/\bflex\b/)) {
      return 'property';
    }

    // Equals sign
    if (stream.match(/=/)) {
      return 'operator';
    }

    // Numbers
    if (stream.match(/\b\d+\b/)) {
      return 'number';
    }

    // Pipe separator in lists/grids
    if (stream.match(/\|/)) {
      return 'punctuation';
    }

    // Skip other whitespace
    if (stream.match(/\s+/)) {
      return null;
    }

    // Skip unknown characters
    stream.next();
    return null;
  },
  startState() {
    return { indent: 0 };
  },
});

export { wireframeLanguage };
