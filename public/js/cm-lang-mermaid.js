/**
 * CodeMirror 6 language support for Mermaid diagrams
 *
 * Token types use StreamLanguage legacy mappings:
 * - keyword → tags.keyword (purple) - diagram types, control keywords
 * - atom → tags.atom (cyan) - directions, states, constants
 * - def → tags.definition (blue) - style definitions
 * - variable → tags.variableName (red) - node IDs
 * - string → tags.string (green) - labels, text in brackets
 * - number → tags.number (orange) - numbers, colors, dates
 * - operator → tags.operator (cyan) - arrows, relationships
 * - bracket → tags.bracket - node shape brackets
 * - punctuation → tags.punctuation - separators
 * - comment → tags.comment (gray) - comments
 */
import { StreamLanguage } from 'https://esm.sh/@codemirror/language@6.10.0';

const mermaidLanguage = StreamLanguage.define({
  token(stream, state) {
    // Comments (must be first to catch %% anywhere)
    if (stream.match(/%%/)) {
      stream.skipToEnd();
      return 'comment';
    }

    // Strings (double or single quoted)
    if (stream.match(/"[^"]*"/)) {
      return 'string';
    }
    if (stream.match(/'[^']*'/)) {
      return 'string';
    }

    // Text in brackets/parens (node labels) - match as strings
    if (stream.match(/\[[^\]]*\]/)) {
      return 'string';
    }
    if (stream.match(/\([^)]*\)/)) {
      return 'string';
    }
    if (stream.match(/\{[^}]*\}/)) {
      return 'string';
    }

    // Diagram type keywords (at start of line or after whitespace)
    if (stream.sol() || state.afterWhitespace) {
      if (stream.match(/\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|sankey-beta|xychart-beta|block-beta)\b/)) {
        return 'keyword';
      }
    }

    // Direction keywords
    if (stream.match(/\b(TB|TD|BT|RL|LR)\b/)) {
      return 'atom';
    }

    // Sequence diagram keywords
    if (stream.match(/\b(participant|actor|activate|deactivate|Note|note|over|left of|right of|loop|alt|else|opt|par|and|critical|break|rect|end|autonumber)\b/)) {
      return 'keyword';
    }

    // Flowchart/graph keywords
    if (stream.match(/\b(subgraph|end|direction)\b/)) {
      return 'keyword';
    }

    // Class diagram keywords
    if (stream.match(/\b(class|namespace|callback|link|cssClass)\b/)) {
      return 'keyword';
    }

    // State diagram keywords
    if (stream.match(/\b(state|note|direction)\b/)) {
      return 'keyword';
    }

    // ER diagram keywords
    if (stream.match(/\b(erDiagram)\b/)) {
      return 'keyword';
    }

    // Gantt keywords
    if (stream.match(/\b(dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|title|section|milestone)\b/)) {
      return 'keyword';
    }

    // Pie chart keywords
    if (stream.match(/\b(showData)\b/)) {
      return 'keyword';
    }

    // Common keywords
    if (stream.match(/\b(title|accTitle|accDescr)\b/)) {
      return 'keyword';
    }

    // Style keywords (def → tags.definition)
    if (stream.match(/\b(style|classDef|linkStyle|click|callback|strokeWidth|stroke|fill|color)\b/)) {
      return 'def';
    }

    // Arrow operators (order matters - longer ones first)
    if (stream.match(/-->>|--xx|--oo|==>>|==xx|==oo|<-->>|<==>>|-\.->>|-\.-x|-\.-o/)) {
      return 'operator';
    }
    if (stream.match(/-->|--x|--o|==>|==x|==o|<-->|<==>|---|-\.-|->|<-|\.->|<\.-/)) {
      return 'operator';
    }
    if (stream.match(/--|\.\.|::|:>/)) {
      return 'operator';
    }

    // ER diagram relationships
    if (stream.match(/\|\|--o\{|\|\|--\|\{|\}o--\|\||\}\|--\|\||\|\|\.\.o\{|\|\|\.\.|\{/)) {
      return 'operator';
    }
    if (stream.match(/\|o|o\||o\{|\}o|\|\{|\}\||\|\|/)) {
      return 'operator';
    }

    // Node shape brackets
    if (stream.match(/\[\[|\]\]|\(\(|\)\)|\{\{|\}\}|\[\(|\)\]|\[\||\|\]|\[\\|\\\]|\[\/|\/\]|>\]|\[</)) {
      return 'bracket';
    }

    // Colors (hex)
    if (stream.match(/#[0-9a-fA-F]{3,8}\b/)) {
      return 'number';
    }

    // Numbers with optional units
    if (stream.match(/\b\d+(?:\.\d+)?(?:%|px|em|rem|pt|s|ms)?\b/)) {
      return 'number';
    }

    // Dates (for gantt)
    if (stream.match(/\b\d{4}-\d{2}-\d{2}\b/)) {
      return 'number';
    }

    // Duration (for gantt)
    if (stream.match(/\b\d+[hdwm]\b/)) {
      return 'number';
    }

    // Keywords for states/conditions
    if (stream.match(/\b(active|done|crit|milestone|after)\b/)) {
      return 'atom';
    }

    // Special state markers
    if (stream.match(/\[\*\]/)) {
      return 'atom';
    }

    // Identifiers/node IDs (variable → tags.variableName)
    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return 'variable';
    }

    // Punctuation
    if (stream.match(/[;:,&]/)) {
      return 'punctuation';
    }

    // Skip whitespace and track it
    if (stream.match(/\s+/)) {
      state.afterWhitespace = true;
      return null;
    }

    state.afterWhitespace = false;
    stream.next();
    return null;
  },
  startState() {
    return { afterWhitespace: true };
  },
});

export { mermaidLanguage };
