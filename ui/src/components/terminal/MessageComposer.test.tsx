import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageComposer } from './MessageComposer';
import { useQuickReplyStore } from '@/stores/quickReplyStore';

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

  it('sends the typed text verbatim (no correction pass)', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'recieve teh msg' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(lastFetchBody().text).toBe('recieve teh msg');
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
    const toggle = screen.getByRole('button', { name: /Enter sends/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(useQuickReplyStore.getState().sendOnEnter).toBe(false);
    expect(screen.getByRole('button', { name: /Enter sends/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables native spellCheck on the composer textarea', () => {
    render(<MessageComposer {...PROPS} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.getAttribute('spellcheck')).toBe('false');
  });

  it('does not throw when window.mc is absent', () => {
    delete (window as any).mc;
    expect(() => render(<MessageComposer {...PROPS} />)).not.toThrow();
  });
});
