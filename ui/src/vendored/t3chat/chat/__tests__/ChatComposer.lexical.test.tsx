import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ChatComposer } from '../ChatComposer';

const SLASH_COMMANDS = [
  { id: 'clear', name: 'clear', description: 'Clear conversation' },
  { id: 'help', name: 'help', description: 'Show help' },
];

// Mock FileMentionPicker to bypass network fetch behavior and make the
// controlled-mode picker observable without a server.
vi.mock('@/components/agent-chat/FileMentionPicker', () => ({
  FileMentionPicker: ({
    query,
    onSelect,
  }: {
    query?: string;
    onSelect?: (p: string) => void;
    onDismiss: () => void;
  }) => (
    <div data-testid="file-mention-picker" data-query={query ?? ''}>
      <button
        type="button"
        data-testid="file-mention-pick-first"
        onClick={() => onSelect?.('src/foo.ts')}
      >
        src/foo.ts
      </button>
    </div>
  ),
}));

function flushTimers() {
  return act(async () => {
    await Promise.resolve();
  });
}

describe('ChatComposer (Lexical)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Lexical ContentEditable instead of a textarea', async () => {
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        slashCommands={SLASH_COMMANDS}
      />,
    );
    await flushTimers();
    expect(screen.getByLabelText('Message composer')).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('shows FileMentionPicker when @-trigger fires, then closes on select', async () => {
    // Import lexical helpers lazily so the mock of FileMentionPicker is active.
    const { $getRoot, $createParagraphNode, $createTextNode } = await import(
      'lexical'
    );
    const { $isMentionNode } = await import('../ComposerMentionNode');

    // Capture the editor so we can drive text updates directly (typing into
    // a Lexical ContentEditable in jsdom is not reliable; driving the state
    // through the editor is the supported approach).
    let capturedEditor: import('lexical').LexicalEditor | null = null;

    // Spy on ComposerPromptEditor by wrapping usage: we pass a sentinel via
    // window when onEditorReady fires. Easier: listen for global editor via
    // a small side-channel we add inline by rendering through ChatComposer
    // and waiting until the editor is attached. Since ChatComposer holds
    // the editor in local state, we instead observe via document and use
    // the editor registered on the contenteditable element.
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        slashCommands={SLASH_COMMANDS}
      />,
    );
    await flushTimers();

    const ce = screen.getByLabelText('Message composer') as HTMLElement & {
      __lexicalEditor?: import('lexical').LexicalEditor;
    };
    // Lexical decorates the ContentEditable host with a `__lexicalEditor`
    // reference (internal but stable across versions we use).
    capturedEditor = ce.__lexicalEditor ?? null;
    // Fallback: search for any element with __lexicalEditor property.
    if (!capturedEditor) {
      const all = document.querySelectorAll('*');
      for (const el of Array.from(all)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (el as any).__lexicalEditor;
        if (e) {
          capturedEditor = e;
          break;
        }
      }
    }
    expect(capturedEditor).toBeTruthy();
    const editor = capturedEditor!;

    // Insert "@fo" into the editor to trigger the mention handler.
    await act(async () => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('@fo'));
          root.append(p);
          p.selectEnd();
        },
        { discrete: true },
      );
    });
    await flushTimers();

    const picker = await screen.findByTestId('file-mention-picker');
    expect(picker).toBeInTheDocument();
    expect(picker.getAttribute('data-query')).toBe('fo');

    // Select a file; picker should close and a MentionNode should be inserted.
    await act(async () => {
      screen.getByTestId('file-mention-pick-first').click();
    });
    await flushTimers();

    expect(screen.queryByTestId('file-mention-picker')).toBeNull();
    let sawMention = false;
    editor.getEditorState().read(() => {
      const walk = (n: import('lexical').LexicalNode) => {
        if ($isMentionNode(n)) sawMention = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maybe = n as any;
        if (typeof maybe.getChildren === 'function') {
          for (const c of maybe.getChildren()) walk(c);
        }
      };
      for (const c of $getRoot().getChildren()) walk(c);
    });
    expect(sawMention).toBe(true);
  });

  it('opens slash menu for "/cl"; single-pill intercept does not call onSend', async () => {
    const { $getRoot, $createParagraphNode, $createTextNode } = await import(
      'lexical'
    );
    const { $createSkillNode } = await import('../ComposerSkillNode');

    const onSend = vi.fn();
    const onSlashCommand = vi.fn(() => true);

    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={onSend}
        onSlashCommand={onSlashCommand}
        slashCommands={SLASH_COMMANDS}
      />,
    );
    await flushTimers();

    // Grab the editor off any node Lexical attached it to.
    let editor: import('lexical').LexicalEditor | null = null;
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = (el as any).__lexicalEditor;
      if (e) {
        editor = e;
        break;
      }
    }
    expect(editor).toBeTruthy();

    // Drive "/cl" into the editor state to fire slash-trigger state update.
    await act(async () => {
      editor!.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('/cl'));
          root.append(p);
          p.selectEnd();
        },
        { discrete: true },
      );
    });
    await flushTimers();

    // Slash menu listbox should be visible with matching results.
    const menu = await screen.findByRole('listbox', { name: 'Slash commands' });
    expect(menu).toBeInTheDocument();
    expect(menu.textContent).toContain('clear');

    // Build a single-pill /clear state and submit via Enter on the editor.
    await act(async () => {
      editor!.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createSkillNode({ command: 'clear' }));
          root.append(p);
          p.selectEnd();
        },
        { discrete: true },
      );
    });
    await flushTimers();

    const ce = screen.getByLabelText('Message composer');
    await act(async () => {
      ce.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushTimers();

    expect(onSend).not.toHaveBeenCalled();
    expect(onSlashCommand).toHaveBeenCalledWith('clear');
  });
});
