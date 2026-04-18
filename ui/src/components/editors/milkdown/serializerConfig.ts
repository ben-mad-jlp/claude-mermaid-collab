import { remarkStringifyOptionsCtx } from '@milkdown/core';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { $markSchema, $nodeSchema } from '@milkdown/utils';

/**
 * Milkdown plugin that overrides remark-stringify defaults to emit
 * `-` for bullet markers and `*` for emphasis/strong, matching our
 * fixture conventions.
 */
const bulletStringifyOption: MilkdownPlugin = (ctx) => async () => {
  ctx.update(remarkStringifyOptionsCtx, (opts) => {
    const prevHandlers = (opts as any).handlers ?? {};
    const prevTextHandler = prevHandlers.text;
    // Undo over-escaping of benign chars in text runs without corrupting
    // literal backslashes. A `\\` in the output represents a single
    // authored '\' and must be preserved; only a lone `\` followed by one of
    // `*_~#` is the stripping target.
    const UNESCAPE_TARGETS = new Set(['*', '_', '~', '#']);
    const unescapeBenign = (s: string): string => {
      let out = '';
      let i = 0;
      while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
          const next = s[i + 1];
          if (next === '\\') {
            out += '\\\\';
            i += 2;
            continue;
          }
          if (UNESCAPE_TARGETS.has(next)) {
            out += next;
            i += 2;
            continue;
          }
        }
        out += s[i];
        i++;
      }
      return out;
    };
    const customTextHandler = (node: any, parent: any, state: any, info: any): string => {
      const original = prevTextHandler
        ? prevTextHandler(node, parent, state, info)
        : state.safe(node.value, info);
      return unescapeBenign(original);
    };
    return {
      ...opts,
      bullet: '-' as const,
      bulletOther: '*' as const,
      bulletOrdered: '.' as const,
      emphasis: '*' as const,
      strong: '*' as const,
      listItemIndent: 'one' as const,
      fences: true as const,
      rule: '-' as const,
      tightDefinitions: true as const,
      handlers: {
        ...prevHandlers,
        text: customTextHandler,
        break: (node: any, _parent: any, _state: any, _info: any): string => {
          const style = node?.data?.style;
          if (style === 'backslash') return '\\\n';
          if (style === 'html') return '<br>\n';
          return '  \n';
        },
      },
      join: [
        (left: any, _right: any, _parent: any, _state: any): number | undefined => {
          const raw = left?.data?.rawTrailing;
          if (typeof raw === 'string') {
            // Convention: a single '\n' means adjacent blocks (0 blank lines),
            // two '\n' means 1 blank line, etc. So blank lines = newlines - 1.
            // Clamp to 0 for the trailing block case (rawTrailing may be '').
            const blankLines = (raw.match(/\n/g) ?? []).length - 1;
            return Math.max(0, blankLines);
          }
          return undefined;
        },
      ],
    };
  });
};

/**
 * Round-trip fidelity plugins for Milkdown.
 *
 * Overrides the default emphasis/strong mark schemas and bullet_list node
 * schema to carry the original markdown marker character through the
 * parse -> prose -> stringify round-trip, so we don't lose fidelity on
 * fixtures that use `_foo_` vs `*foo*`, `-` vs `*` bullets, etc.
 *
 */

/**
 * hardBreak style ('spaces' | 'backslash' | 'html') is preserved
 * through the round-trip via a node attr, so fixtures keep their
 * original line-break literal ('  \n', '\\\n', or '<br>\n').
 */

const emphasisMarker = $markSchema('emphasis', () => ({
  attrs: { marker: { default: '*' } },
  parseDOM: [
    { tag: 'em' },
    { tag: 'i' },
    { style: 'font-style=italic' },
  ],
  toDOM: (mark) => ['em', { 'data-marker': mark.attrs.marker }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'emphasis',
    runner: (state, node, markType) => {
      state.openMark(markType, { marker: (node as any).marker ?? '*' });
      state.next((node as any).children ?? []);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'emphasis',
    runner: (state, mark) => {
      state.withMark(mark, 'emphasis');
    },
  },
}));

const strongMarker = $markSchema('strong', () => ({
  attrs: { marker: { default: '*' } },
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b' },
    { style: 'font-weight=bold' },
  ],
  toDOM: (mark) => ['strong', { 'data-marker': mark.attrs.marker }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'strong',
    runner: (state, node, markType) => {
      state.openMark(markType, { marker: (node as any).marker ?? '*' });
      state.next((node as any).children ?? []);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'strong',
    runner: (state, mark) => {
      state.withMark(mark, 'strong');
    },
  },
}));

const bulletListMarker = $nodeSchema('bullet_list', () => ({
  content: 'list_item+',
  group: 'block',
  attrs: {
    spread: { default: 'false' },
    bullet: { default: '-' },
  },
  parseDOM: [
    {
      tag: 'ul',
      getAttrs: (dom: any) => ({
        spread: dom.dataset?.spread ?? 'false',
        bullet: dom.dataset?.bullet ?? '-',
      }),
    },
  ],
  toDOM: (node) => [
    'ul',
    {
      'data-spread': node.attrs.spread,
      'data-bullet': node.attrs.bullet,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'list' && !(node as any).ordered,
    runner: (state, node, type) => {
      state.openNode(type, {
        spread: String((node as any).spread ?? false),
        bullet: (node as any).marker ?? '-',
      });
      state.next((node as any).children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'bullet_list',
    runner: (state, node) => {
      // Keep list tight at the parent level. Per-item looseness (blank line
      // between specific items, e.g. around a diagramEmbed) is handled via
      // the custom `join` function using listItem.rawTrailing.
      state.openNode('list', undefined, { ordered: false, spread: false });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

const orderedListMarker = $nodeSchema('ordered_list', () => ({
  content: 'list_item+',
  group: 'block',
  attrs: {
    spread: { default: 'false' },
    marker: { default: '.' },
    start: { default: 1 },
  },
  parseDOM: [
    {
      tag: 'ol',
      getAttrs: (dom: any) => {
        const startAttr = dom.getAttribute?.('start');
        const startNum = startAttr != null ? parseInt(startAttr, 10) : NaN;
        return {
          spread: dom.dataset?.spread ?? 'false',
          marker: dom.dataset?.marker ?? '.',
          start: Number.isFinite(startNum) ? startNum : 1,
        };
      },
    },
  ],
  toDOM: (node) => [
    'ol',
    {
      'data-spread': node.attrs.spread,
      'data-marker': node.attrs.marker,
      start: node.attrs.start,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'list' && Boolean((node as any).ordered),
    runner: (state, node, type) => {
      // Extract marker delimiter ('.' or ')') from any raw-position markers
      // on the node or its children, if present.
      let marker: '.' | ')' = '.';
      const candidates: any[] = [];
      const raw = (node as any).marker;
      if (typeof raw === 'string') candidates.push(raw);
      const children = (node as any).children ?? [];
      for (const child of children) {
        if (typeof child?.marker === 'string') candidates.push(child.marker);
      }
      for (const c of candidates) {
        if (c.endsWith(')')) { marker = ')'; break; }
        if (c.endsWith('.')) { marker = '.'; break; }
      }
      const start = typeof (node as any).start === 'number' ? (node as any).start : 1;
      state.openNode(type, {
        spread: String((node as any).spread ?? false),
        marker,
        start,
      });
      state.next(children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'ordered_list',
    runner: (state, node) => {
      const start = typeof (node.attrs as any).start === 'number' ? (node.attrs as any).start : 1;
      state.openNode('list', undefined, { ordered: true, spread: false, start });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

/**
 * Override list_item to control spread per-item on toMarkdown. The parent
 * list stays tight (spread=false) by default; individual items go loose
 * only when they carry a diagramEmbed child, so reserialized lists stay
 * tight unless a specific item needs the extra spacing around an embed.
 */
const listItemTight = $nodeSchema('list_item', () => ({
  group: 'listItem',
  content: 'paragraph block*',
  attrs: {
    label: { default: '•' },
    listType: { default: 'bullet' },
    spread: { default: false },
    rawTrailing: { default: '' },
    checked: { default: null as boolean | null },
  },
  defining: true,
  parseDOM: [
    {
      tag: 'li',
      getAttrs: (dom: any) => {
        const checkedAttr = dom.dataset?.checked;
        return {
          label: dom.dataset?.label ?? '•',
          listType: dom.dataset?.listType ?? 'bullet',
          spread: false,
          checked: checkedAttr === 'true' ? true : checkedAttr === 'false' ? false : null,
        };
      },
    },
  ],
  toDOM: (node) => [
    'li',
    {
      'data-label': node.attrs.label,
      'data-list-type': node.attrs.listType,
      'data-spread': 'false',
      ...(node.attrs.checked !== null ? { 'data-checked': String(node.attrs.checked) } : {}),
    },
    0,
  ],
  parseMarkdown: {
    match: ({ type }: any) => type === 'listItem',
    runner: (state, node, type) => {
      // mdast listItem has no `label`/`ordered` field of its own. The ordered
      // flag lives on the parent `list` node; detect via the current open
      // ProseMirror parent which was opened by the bullet_list / ordered_list
      // runners. When the parent is ordered, synthesize a numeric label from
      // the item's index within its siblings.
      const parentName = (state as any).parent?.type?.name as string | undefined;
      const isOrdered = parentName === 'ordered_list';
      let label = '•';
      if (isOrdered) {
        const parentChildren = (state as any).parent?.content as any[] | undefined;
        const idx = Array.isArray(parentChildren) ? parentChildren.length : 0;
        label = `${idx + 1}.`;
      }
      const listType = isOrdered ? 'ordered' : 'bullet';
      const rawTrailing = typeof (node as any).data?.rawTrailing === 'string'
        ? (node as any).data.rawTrailing
        : '';
      const checked = typeof (node as any).checked === 'boolean' ? (node as any).checked : null;
      state.openNode(type, { label, listType, spread: false, rawTrailing, checked });
      state.next((node as any).children ?? []);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'list_item',
    runner: (state, node) => {
      const hasEmbed = (() => {
        let found = false;
        node.content.forEach((child: any) => {
          if (child.type?.name === 'diagramEmbed') found = true;
        });
        return found;
      })();
      const raw = (node.attrs as any).rawTrailing;
      const checked = (node.attrs as any).checked;
      const props: any = { spread: hasEmbed };
      if (typeof raw === 'string' && raw.length > 0) {
        props.data = { rawTrailing: raw };
      }
      if (checked === true || checked === false) {
        props.checked = checked;
      }
      state.openNode('listItem', undefined, props);
      state.next(node.content);
      state.closeNode();
    },
  },
}));

/**
 * Override the heading schema to carry the original markdown's rawTrailing
 * (the whitespace/newline slice between this heading and the next block) as
 * a ProseMirror attr. On serialize, we place it back on the mdast node's
 * `data` so the `join` function can consult it and reproduce the exact
 * blank-line count that was in the source.
 */
const headingRawTrailing = $nodeSchema('heading', () => ({
  content: 'inline*',
  group: 'block',
  defining: true,
  attrs: {
    id: { default: '' },
    level: { default: 1 },
    rawTrailing: { default: '' },
  },
  parseDOM: [1, 2, 3, 4, 5, 6].map((x) => ({
    tag: `h${x}`,
    getAttrs: (dom: any) => ({ level: x, id: dom.id ?? '' }),
  })),
  toDOM: (node: any) => [`h${node.attrs.level}`, { id: node.attrs.id }, 0],
  parseMarkdown: {
    match: ({ type }: any) => type === 'heading',
    runner: (state, node: any, type) => {
      const rawTrailing = typeof node.data?.rawTrailing === 'string' ? node.data.rawTrailing : '';
      state.openNode(type, { level: node.depth, rawTrailing });
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'heading',
    runner: (state, node) => {
      const raw = (node.attrs as any).rawTrailing;
      const props: any = { depth: node.attrs.level };
      if (typeof raw === 'string' && raw.length > 0) {
        props.data = { rawTrailing: raw };
      }
      state.openNode('heading', undefined, props);
      state.next(node.content);
      state.closeNode();
    },
  },
}));

const hardBreakStyle = $nodeSchema('hardbreak', () => ({
  inline: true,
  group: 'inline',
  selectable: false,
  attrs: {
    isInline: { default: false },
    style: { default: 'spaces' },
  },
  parseDOM: [
    {
      tag: 'br',
      getAttrs: (dom: any) => ({
        isInline: false,
        style: dom.dataset?.style ?? 'spaces',
      }),
    },
    {
      tag: 'span[data-type="hardbreak"]',
      getAttrs: (dom: any) => ({
        isInline: true,
        style: dom.dataset?.style ?? 'spaces',
      }),
    },
  ],
  toDOM: (node) =>
    node.attrs.isInline
      ? ['span', { 'data-type': 'hardbreak', 'data-style': node.attrs.style }, ' ']
      : ['br', { 'data-style': node.attrs.style }],
  parseMarkdown: {
    match: (node) => node.type === 'break',
    runner: (state, node, type) => {
      const raw = (node as any).data?.style
        ?? ((node as any).data?.hName === 'br' ? 'html' : undefined);
      const style: 'spaces' | 'backslash' | 'html' =
        raw === 'backslash' || raw === 'html' || raw === 'spaces'
          ? raw
          : 'spaces';
      state.addNode(type, { isInline: Boolean((node as any).data?.isInline), style });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'hardbreak',
    runner: (state, node) => {
      if (node.attrs.isInline) {
        state.addNode('text', undefined, '\n');
        return;
      }
      // Emit a real mdast `break` node and carry the style forward via data;
      // the custom `break` handler in remarkStringifyOptionsCtx consults
      // node.data.style to emit the exact literal ('  \n' | '\\\n' | '<br>\n').
      state.addNode('break', undefined, undefined, { data: { style: node.attrs.style } });
    },
  },
}));

export const fidelityPlugins: MilkdownPlugin[] = [
  bulletStringifyOption,
  emphasisMarker,
  strongMarker,
  bulletListMarker,
  orderedListMarker,
  listItemTight,
  headingRawTrailing,
  hardBreakStyle,
].flat() as MilkdownPlugin[];

export default fidelityPlugins;
