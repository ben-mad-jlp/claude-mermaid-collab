import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { UserInputCard } from '../UserInputCard';

describe('UserInputCard', () => {
  afterEach(() => cleanup());

  it('text mode: typing and submitting calls onRespond with text value', () => {
    const onRespond = vi.fn();
    render(
      <UserInputCard
        promptId="p1"
        prompt="What is your name?"
        expectedKind="text"
        onRespond={onRespond}
      />,
    );
    const ta = screen.getByLabelText('Response text') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(onRespond).toHaveBeenCalledWith({ kind: 'text', text: 'Alice' });
  });

  it('text mode: does not submit when blank', () => {
    const onRespond = vi.fn();
    render(
      <UserInputCard
        promptId="p1"
        prompt="Say something"
        expectedKind="text"
        onRespond={onRespond}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Submit response' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('choice mode: clicking a choice calls onRespond with choiceId', () => {
    const onRespond = vi.fn();
    render(
      <UserInputCard
        promptId="p1"
        prompt="Pick one"
        expectedKind="choice"
        choices={[
          { id: 'a', label: 'Apple' },
          { id: 'b', label: 'Banana' },
        ]}
        onRespond={onRespond}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Banana' }));
    expect(onRespond).toHaveBeenCalledWith({ kind: 'choice', choiceId: 'b' });
  });

  describe('countdown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders and updates countdown every second', () => {
      const deadlineMs = Date.now() + 65_000; // 1:05
      render(
        <UserInputCard
          promptId="p1"
          prompt="hurry"
          expectedKind="text"
          deadlineMs={deadlineMs}
          onRespond={() => {}}
        />,
      );
      expect(screen.getByLabelText('Time remaining').textContent).toBe('01:05');
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByLabelText('Time remaining').textContent).toBe('01:04');
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByLabelText('Time remaining').textContent).toBe('00:59');
    });

    it('clamps at 00:00 past deadline', () => {
      const deadlineMs = Date.now() + 2000;
      render(
        <UserInputCard
          promptId="p1"
          prompt="hurry"
          expectedKind="text"
          deadlineMs={deadlineMs}
          onRespond={() => {}}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByLabelText('Time remaining').textContent).toBe('00:00');
    });
  });
});
