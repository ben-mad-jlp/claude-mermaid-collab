import { render, screen, fireEvent } from '@testing-library/react';
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
    useQuickReplyStore.setState({ sendOnEnter: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

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

describe('MessageComposer — autocorrect suggest mode', () => {
  beforeEach(() => {
    mockMode = 'suggest';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true });
    addSpy.mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function typeWord(ta: HTMLTextAreaElement, text: string) {
    fireEvent.change(ta, { target: { value: text, selectionStart: text.length } });
  }

  it('chip appears when a correctable word is followed by space', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'beleive ');
    expect(screen.getByText(/believe/i)).toBeInTheDocument();
  });

  it('Tab applies the suggestion and preserves trailing space', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'beleive ');
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(ta.value).toBe('believe ');
  });

  it('Escape dismisses the chip without applying', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'beleive ');
    expect(screen.getByText(/believe/i)).toBeInTheDocument();
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByText(/believe/i)).not.toBeInTheDocument();
    expect(ta.value).toBe('beleive ');
  });

  it('[+] button adds to dict and dismisses', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'beleive ');
    const addBtn = screen.getByRole('button', { name: /add to dict|\+/i });
    fireEvent.mouseDown(addBtn);
    fireEvent.click(addBtn);
    expect(addSpy).toHaveBeenCalledWith('/p', 'beleive');
    expect(screen.queryByText(/believe/i)).not.toBeInTheDocument();
  });
});

describe('MessageComposer — autocorrect pre-send & auto mode', () => {
  beforeEach(() => {
    mockMode = 'suggest';
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useQuickReplyStore.setState({ sendOnEnter: true });
    addSpy.mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function typeWord(ta: HTMLTextAreaElement, text: string) {
    fireEvent.change(ta, { target: { value: text, selectionStart: text.length } });
  }

  it('suggest/auto pre-send corrects the final unspaced token', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('receive');
  });

  it('off mode passes through unchanged', () => {
    mockMode = 'off';
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('recieve');
  });

  it('auto mode inline-apply + undo without learning', () => {
    mockMode = 'auto';
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    typeWord(ta, 'recieve ');
    expect(ta.value).toBe('receive ');
    fireEvent.keyDown(ta, { key: 'z', metaKey: true });
    expect(ta.value).toBe('recieve ');
    expect(addSpy).not.toHaveBeenCalled();
  });
});
