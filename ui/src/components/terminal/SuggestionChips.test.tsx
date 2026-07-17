import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuggestionChips } from './SuggestionChips';
import { MessageComposer } from './MessageComposer';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useTerminalComposerDraftStore } from '@/stores/terminalComposerDraftStore';
import type { SessionSummary } from '@/stores/supervisorStore';

/**
 * SuggestionChips — structured, AI-proposed reply chips. Verifies chip rendering
 * from the session summary's `structured` payload, stage-not-send tap behaviour,
 * turn/session freshness gating, typing-clears, and vacuous filtering.
 */

const BASE: SessionSummary = {
  project: 'p',
  session: 's',
  progressState: 'idle',
  paneSeenAt: 0,
  updatedAt: 0,
  paneHash: 'h1',
  summaryPaneHash: 'h1',
  structured: {
    paragraph: 'x',
    status: 'needs-input',
  },
};

function seed(structured: SessionSummary['structured'], overrides: Partial<SessionSummary> = {}) {
  useSupervisorStore.setState({
    sessionSummaries: { 'p::s': { ...BASE, structured, ...overrides } },
  });
}

describe('SuggestionChips', () => {
  beforeEach(() => {
    delete (window as any).mc;
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response)) as any;
    useSupervisorStore.setState({ sessionSummaries: {} });
    useTerminalComposerDraftStore.setState({ hasText: false });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders one chip per option', () => {
    seed({
      paragraph: 'x', status: 'needs-input',
      options: [{ label: 'Yes', valueToSend: 'yes' }, { label: 'No', valueToSend: 'no' }],
    });
    render(<SuggestionChips project="p" session="s" />);
    expect(screen.getByRole('button', { name: /yes/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /no/i })).toBeTruthy();
  });

  it('tapping a chip stages into the composer and never sends', () => {
    seed({
      paragraph: 'x', status: 'needs-input',
      options: [{ label: 'Yes', valueToSend: 'yes' }, { label: 'No', valueToSend: 'no' }],
    });
    render(
      <>
        <SuggestionChips project="p" session="s" />
        <MessageComposer project="p" session="s" serverId="srv" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('yes');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('hides the chip when the pane hash advances past the summary pane hash', () => {
    seed({ paragraph: 'x', status: 'needs-input', suggestedAnswers: ['Rewrite the auth middleware'] });
    render(<SuggestionChips project="p" session="s" />);
    expect(screen.getByRole('button', { name: /rewrite the auth middleware/i })).toBeTruthy();

    act(() => {
      useSupervisorStore.setState({
        sessionSummaries: {
          'p::s': {
            ...BASE,
            paneHash: 'h2',
            structured: { paragraph: 'x', status: 'needs-input', suggestedAnswers: ['Rewrite the auth middleware'] },
          },
        },
      });
    });
    expect(screen.queryByRole('button', { name: /rewrite the auth middleware/i })).toBeNull();
  });

  it('hides the chip on session switch with no matching summary', () => {
    seed({ paragraph: 'x', status: 'needs-input', suggestedAnswers: ['Rewrite the auth middleware'] });
    const { rerender } = render(<SuggestionChips project="p" session="s" />);
    expect(screen.getByRole('button', { name: /rewrite the auth middleware/i })).toBeTruthy();
    rerender(<SuggestionChips project="p" session="other" />);
    expect(screen.queryByRole('button', { name: /rewrite the auth middleware/i })).toBeNull();
  });

  it('typing in the composer clears the chip', () => {
    seed({ paragraph: 'x', status: 'needs-input', suggestedAnswers: ['Rewrite the auth middleware'] });
    render(<SuggestionChips project="p" session="s" />);
    expect(screen.getByRole('button', { name: /rewrite the auth middleware/i })).toBeTruthy();
    act(() => useTerminalComposerDraftStore.getState().setHasText(true));
    expect(screen.queryByRole('button', { name: /rewrite the auth middleware/i })).toBeNull();
  });

  it('filters vacuous suggested answers', () => {
    seed({ paragraph: 'x', status: 'needs-input', suggestedAnswers: ['ok', 'continue', 'Rewrite the auth middleware'] });
    render(<SuggestionChips project="p" session="s" />);
    expect(screen.getByRole('button', { name: /rewrite the auth middleware/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^ok$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull();
  });
});
