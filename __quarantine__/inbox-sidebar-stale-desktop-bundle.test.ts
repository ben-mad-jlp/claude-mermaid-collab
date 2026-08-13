import { describe, it, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

/**
 * FINDING: the sidebar-tree Inbox section (mission 12ae01d9 crit 6 —
 * InboxSection.tsx / InboxPreview.tsx, data-testid="sidebar-section-inbox" etc.)
 * does not render in the live desktop app at http://localhost:9002, even though
 * GET /api/artifact-inbox correctly lists a pending envelope. `desktop_eval`
 * against the running renderer found ZERO elements with any [data-testid]
 * attribute at all.
 *
 * ROOT CAUSE: the packaged desktop app (app.asar) is a stale build — it was
 * produced BEFORE the commit that last touched InboxSection.tsx, so the shipped
 * feature is simply not present in the deployed renderer. This asserts the
 * claim "the deployed app is at least as new as its own Inbox-section source" —
 * it is expected to be RED until the desktop app is rebuilt/redeployed.
 */

const REPO_ROOT = '/Users/benmaderazo/Code/claude-mermaid-collab';
const ASAR_PATH = '/Applications/Mermaid Collab.app/Contents/Resources/app.asar';
const INBOX_SECTION_SRC = 'ui/src/components/layout/sidebar-tree/sections/InboxSection.tsx';

describe('deployed desktop app vs Inbox sidebar source', () => {
  it('app.asar is at least as new as the last InboxSection.tsx commit', () => {
    const asarMtimeMs = statSync(ASAR_PATH).mtimeMs;

    const lastCommitIso = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', INBOX_SECTION_SRC],
      { cwd: REPO_ROOT }
    )
      .toString()
      .trim();
    expect(lastCommitIso).not.toBe('');
    const lastCommitMs = new Date(lastCommitIso).getTime();

    expect(asarMtimeMs).toBeGreaterThanOrEqual(lastCommitMs);
  });
});
