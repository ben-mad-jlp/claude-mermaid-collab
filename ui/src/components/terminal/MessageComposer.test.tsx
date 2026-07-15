import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { useQuickReplyStore } from '@/stores/quickReplyStore';

// Mock autocorrect hooks for deterministic testing.
let mockMode: 'off' | 'suggest' | 'auto' = 'suggest';
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
    mockMode = 'suggest';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true, autocorrectMode: 'off' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('the autocorrect-mode select reflects + updates the persisted mode', () => {
    // Order-independent: the beforeEach above pins autocorrectMode to 'off'.
    render(<MessageComposer {...PROPS} />);
    const sel = screen.getByTestId('autocorrect-mode-select') as HTMLSelectElement;
    expect(sel.value).toBe('off');
    fireEvent.change(sel, { target: { value: 'suggest' } });
    expect(useQuickReplyStore.getState().autocorrectMode).toBe('suggest');
    expect((screen.getByTestId('autocorrect-mode-select') as HTMLSelectElement).value).toBe('suggest');
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

  it('the Enter-sends checkbox reflects + updates the persisted toggle', () => {
    render(<MessageComposer {...PROPS} />);
    const cb = screen.getByRole('checkbox') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(useQuickReplyStore.getState().sendOnEnter).toBe(false);
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

describe('MessageComposer — suggest mode (deferred apply + green highlight + undo)', () => {
  beforeEach(() => {
    mockMode = 'suggest';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true });
    vi.useFakeTimers();
  });
  afterEach(() => { act(() => { vi.runOnlyPendingTimers(); }); vi.useRealTimers(); vi.restoreAllMocks(); });

  function typeWord(ta: HTMLTextAreaElement, text: string) {
    fireEvent.change(ta, { target: { value: text, selectionStart: text.length } });
  }
  const settle = () => act(() => { vi.advanceTimersByTime(700); });

  it('does NOT correct while typing; applies + highlights after the pause', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'please recieve it');
    expect(ta.value).toBe('please recieve it'); // untouched mid-typing
    settle();
    expect(ta.value).toBe('please receive it'); // corrected after debounce
    expect(screen.getByText(/Autocorrected 1 word/i)).toBeInTheDocument();
  });

  it('Undo button reverts to exactly what was typed', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    settle();
    expect(ta.value).toBe('receive');
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));
    expect(ta.value).toBe('recieve');
    expect(screen.queryByText(/Autocorrected/i)).not.toBeInTheDocument();
  });

  it('⌘Z reverts the debounced correction pass', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    settle();
    expect(ta.value).toBe('receive');
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(ta.value).toBe('recieve');
  });

  it('after Undo, Enter sends the ORIGINAL (no re-correct on send)', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    settle();
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('recieve');
  });

  it('Enter BEFORE the debounce still corrects (flush on send)', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    fireEvent.keyDown(ta, { key: 'Enter' }); // no timer advance
    expect(lastFetchBody().text).toBe('receive');
  });

  it('editing after a pass clears the green + re-enables correcting', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    settle();
    expect(screen.getByText(/Autocorrected/i)).toBeInTheDocument();
    typeWord(ta, 'recieve x'); // keep typing
    expect(screen.queryByText(/Autocorrected/i)).not.toBeInTheDocument();
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
