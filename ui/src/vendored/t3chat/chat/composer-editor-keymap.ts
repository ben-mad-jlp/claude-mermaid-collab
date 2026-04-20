import {
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from 'lexical';

export interface ComposerKeymapOptions {
  onSubmit: () => void;
  onCancel: () => void;
  onMenuOpen: (trigger: '/' | '@') => void;
}

export interface ComposerKeymap {
  register: (editor: LexicalEditor) => () => void;
}

/**
 * Build a set of Lexical command handlers for the composer keyboard model.
 * Returns an object with a `register(editor)` method that installs the
 * handlers and returns an unregister function.
 */
export function createComposerKeymap(opts: ComposerKeymapOptions): ComposerKeymap {
  const register = (editor: LexicalEditor): (() => void) => {
    const unregisters: Array<() => void> = [];

    unregisters.push(
      editor.registerCommand<KeyboardEvent | null>(
        KEY_ENTER_COMMAND,
        (event) => {
          // Shift+Enter = newline (default); plain Enter = submit.
          if (event && event.shiftKey) return false;
          event?.preventDefault?.();
          opts.onSubmit();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    unregisters.push(
      editor.registerCommand<KeyboardEvent>(
        KEY_ESCAPE_COMMAND,
        (event) => {
          event?.preventDefault?.();
          opts.onCancel();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    // Slash / at-sign menu triggers.
    unregisters.push(
      editor.registerCommand<KeyboardEvent>(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key === '/') {
            opts.onMenuOpen('/');
            return false; // let it type
          }
          if (event.key === '@') {
            opts.onMenuOpen('@');
            return false;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    return () => {
      for (const u of unregisters) {
        try {
          u();
        } catch {
          // ignore
        }
      }
    };
  };

  return { register };
}
