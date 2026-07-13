/**
 * paneShowsPrompt + sendNudgeGuarded — the auto-nudge guard that defers (soft no-op)
 * when an interactive prompt is open in the target pane, preventing a stray Enter
 * from auto-submitting the highlighted default answer.
 */
import { describe, it, expect } from 'bun:test';
import { paneShowsPrompt, sendNudgeGuarded } from '../tmux-send.ts';

describe('paneShowsPrompt', () => {
  it('detects an AskUserQuestion prompt with numbered options + ❯ cursor', () => {
    const pane = `
  1. Option A
  ❯ 2. Option B
  3. Option C

Submit answers
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('detects a permission dialog "Do you want to proceed?"', () => {
    const pane = `
Do you want to proceed? This will deploy the changes.

  ❯ 1. Yes
    2. No
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('detects a plan-approval prompt "Would you like to proceed?"', () => {
    const pane = `
Would you like to proceed with this plan?

  ❯ 1. Yes
    No, keep planning
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('detects the "No, keep planning" reject option', () => {
    const pane = `
  1. Approve
  ❯ 2. No, keep planning
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('detects "Submit answers" text', () => {
    const pane = `
  1. Option A
  ❯ 2. Option B

Submit answer now
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('detects the ❯ selection cursor on a numbered option', () => {
    const pane = `
  1. First item
  ❯ 2. Second item
  3. Third item
    `;
    expect(paneShowsPrompt(pane)).toBe(true);
  });

  it('returns false for an idle REPL pane with ctx | status', () => {
    const pane = `
claude Code 0.5.123
https://claude.ai  [stdin]

> 🧠 0% ctx |
    `;
    expect(paneShowsPrompt(pane)).toBe(false);
  });

  it('returns false for an empty pane', () => {
    expect(paneShowsPrompt('')).toBe(false);
  });

  it('returns false for a regular prompt without interactive markers', () => {
    const pane = `
claude Code session started.

> 🧠 100% ctx |
    `;
    expect(paneShowsPrompt(pane)).toBe(false);
  });
});

describe('sendNudgeGuarded', () => {
  it('defers when pane shows a prompt (returns prompt-open)', async () => {
    const promptPane = `
  1. Option A
  ❯ 2. Option B

Submit answers
    `;
    const result = await sendNudgeGuarded('mc-nudge-guard-test', 'hello', promptPane);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('prompt-open');
  });

  it('does NOT defer for idle pane (falls through to sendTmuxKeysRaw)', async () => {
    const idlePane = `
claude Code 0.5.123

> 🧠 0% ctx |
    `;
    const result = await sendNudgeGuarded(
      'mc-nudge-guard-test-nosession',
      'hello',
      idlePane,
    );
    expect(result.reason).not.toBe('prompt-open');
  });
});
