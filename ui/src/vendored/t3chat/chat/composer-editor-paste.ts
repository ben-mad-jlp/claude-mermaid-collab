import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $createMentionNode } from './ComposerMentionNode';
import { $createSkillNode } from './ComposerSkillNode';

export interface PasteHandler {
  command: LexicalCommand<ClipboardEvent>;
  priority: number;
  handler: (event: ClipboardEvent, editor: LexicalEditor) => boolean;
  register: (editor: LexicalEditor) => () => void;
}

// Match @path — permit alnum, _, -, ., /, :, so @foo/bar.ts works.
const MENTION_RE = /@([A-Za-z0-9_./:\-]+)/g;
// Slash-command at line start: /cmd (cmd is alnum + dash + underscore).
const SKILL_RE = /^\/([A-Za-z0-9_-]+)/;

/**
 * Parse a raw pasted string into an ordered list of Lexical nodes. Exposed
 * for testing the transformation logic independently of PASTE_COMMAND wiring.
 */
export function parsePastedText(text: string): LexicalNode[] {
  const out: LexicalNode[] = [];
  const lines = text.split(/(\r?\n)/); // keep newlines as separators

  for (const line of lines) {
    if (line === '') continue;
    if (line === '\n' || line === '\r\n') {
      out.push($createTextNode(line));
      continue;
    }

    // Slash command at line start.
    const skillMatch = line.match(SKILL_RE);
    if (skillMatch) {
      out.push($createSkillNode({ command: skillMatch[1] }));
      const rest = line.slice(skillMatch[0].length);
      if (rest) out.push(...parseMentions(rest));
      continue;
    }

    out.push(...parseMentions(line));
  }

  return out;
}

function parseMentions(segment: string): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(segment)) !== null) {
    const start = m.index;
    if (start > lastIndex) {
      nodes.push($createTextNode(segment.slice(lastIndex, start)));
    }
    const path = m[1];
    const display = path.split('/').pop() || path;
    nodes.push($createMentionNode({ path, display }));
    lastIndex = start + m[0].length;
  }
  if (lastIndex < segment.length) {
    nodes.push($createTextNode(segment.slice(lastIndex)));
  }
  return nodes;
}

/**
 * Build a PASTE_COMMAND handler that rewrites pasted plain text into
 * MentionNode / SkillNode where applicable.
 */
export function createPasteHandler(): PasteHandler {
  const handler = (event: ClipboardEvent, editor: LexicalEditor): boolean => {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return false;
    event.preventDefault();
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const nodes = parsePastedText(text);
        if (nodes.length > 0) {
          selection.insertNodes(nodes);
        }
      },
      { discrete: true },
    );
    return true;
  };

  const register = (editor: LexicalEditor): (() => void) => {
    return editor.registerCommand<ClipboardEvent>(
      PASTE_COMMAND,
      (e) => handler(e, editor),
      COMMAND_PRIORITY_LOW,
    );
  };

  return {
    command: PASTE_COMMAND,
    priority: COMMAND_PRIORITY_LOW,
    handler,
    register,
  };
}
