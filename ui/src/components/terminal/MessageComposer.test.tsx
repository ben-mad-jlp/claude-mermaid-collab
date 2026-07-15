import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { useQuickReplyStore } from '@/stores/quickReplyStore';

// Mock autocorrect hooks for deterministic testing.
let mockMode: 'off' | 'auto' = 'off';
vi.mock('@/hooks/useAutocorrect', () => ({
  useAutocorrect: () => ({
    get mode() { return mockMode; },
    correct: (t: string) =>
      t.toLowerCase() === 'recieve' ? { from: t, to: 'receive', strength: 'strong' }
      : t.toLowerCase() === 'beleive' ? { from: t, to: 'believe', strength: 'strong' } : null,
    correctMessage: (text: string) => {
      const m = /recieve/.exec(text);
      return m ? [{ start: m.index, end: m.index + 7, from: 'recieve', to: 'receive' }] : [];
    },
    vocabWords: ['recieveproject', 'planner'],
  }),
}));

const addSpy = vi.fn();
vi.mock('@/lib/autocorrect/personalDict', () => ({
  addToPersonalDict: (...a: any[]) => addSpy(...a),
  getPersonalDict: () => new Set<string>(),
}));

/**
 * MessageComposer — the multi-line composer below the quick-reply chips. Verifies
 * the Enter-sends toggle, Shift+Enter newline, button send, empty-send guard, and
 * the tmux-send-keys POST payload (submit:true). window.mc is unset in jsdom, so
 * the fetch fallback is exercised.
 */

const PROPS = { project: '/p', session: 's', serverId: 'srv' };

function lastFetchBody(): any {
  const calls = (globalThis.fetch as any).mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

describe('MessageComposer', () => {
  beforeEach(() => {
    mockMode = 'off';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true, autocorrectMode: 'off' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('the autocorrect toggle reflects on/off and flips the persisted mode', () => {
    // Order-independent: the beforeEach above pins autocorrectMode to 'off'.
    render(<MessageComposer {...PROPS} />);
    const toggle = screen.getByTestId('autocorrect-toggle');
    expect(toggle).toHaveTextContent(/off/i);
    fireEvent.click(toggle);
    expect(useQuickReplyStore.getState().autocorrectMode).toBe('auto');
    expect(screen.getByTestId('autocorrect-toggle')).toHaveTextContent(/on/i);
    fireEvent.click(screen.getByTestId('autocorrect-toggle'));
    expect(useQuickReplyStore.getState().autocorrectMode).toBe('off');
  });

  it('Enter sends when "Enter sends" is on, with submit:true and the typed text', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello world' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = lastFetchBody();
    expect(body).toMatchObject({ project: '/p', session: 's', text: 'hello world', submit: true });
    expect(ta.value).toBe(''); // cleared after send
  });

  it('Shift+Enter inserts a newline and does NOT send', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'line1' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ta.value).toBe('line1'); // not cleared
  });

  it('with "Enter sends" off, plain Enter does not send but ⌘/Ctrl+Enter does', () => {
    useQuickReplyStore.setState({ sendOnEnter: false });
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'msg' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('the Send button submits the current text', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'via button' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    expect(lastFetchBody().text).toBe('via button');
  });

  it('does not send empty / whitespace-only text', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '   ' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the Enter-sends toggle reflects + updates the persisted toggle', () => {
    render(<MessageComposer {...PROPS} />);
    const toggle = screen.getByRole('button', { name: /Enter sends: on/i });
    fireEvent.click(toggle);
    expect(useQuickReplyStore.getState().sendOnEnter).toBe(false);
    expect(screen.getByRole('button', { name: /Enter sends: off/i })).toBeInTheDocument();
  });

  it('enables spellCheck on the composer textarea', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.getAttribute('spellcheck')).toBe('true');
  });

  it('pushes new vocab words to window.mc.addSpellCheckWords when the bridge is present', () => {
    const push = vi.fn();
    (window as any).mc = { addSpellCheckWords: push };
    render(<MessageComposer {...PROPS} />);
    expect(push).toHaveBeenCalled();
    expect(push.mock.calls[0][0]).toEqual(expect.arrayContaining(['planner']));
    delete (window as any).mc;
  });

  it('does not throw when window.mc is absent', () => {
    delete (window as any).mc;
    expect(() => render(<MessageComposer {...PROPS} />)).not.toThrow();
  });
});

describe('MessageComposer — auto & off send semantics', () => {
  beforeEach(() => {
    mockMode = 'auto';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function typeWord(ta: HTMLTextAreaElement, text: string) {
    fireEvent.change(ta, { target: { value: text, selectionStart: text.length } });
  }

  it('auto corrects on SEND only, never while typing', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve '); // space would have triggered the old inline apply
    expect(ta.value).toBe('recieve '); // NOT corrected while typing
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('receive '); // corrected on send
  });

  it('off mode passes through unchanged', () => {
    mockMode = 'off';
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('recieve');
  });
});
