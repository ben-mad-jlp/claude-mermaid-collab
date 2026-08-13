import { describe, it, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';

/**
 * FINDING: the sidebar-tree Inbox section (mission 12ae01d9 crit 6 —
 * InboxSection.tsx / InboxPreview.tsx, data-testid="sidebar-section-inbox" etc.)
 * did not render in the live desktop app at http://localhost:9002 during this
 * investigation, even though GET /api/artifact-inbox correctly listed a pending
 * envelope (f2826d30-910b-4826-a661-79c62e3df88a). `desktop_eval` against the
 * running renderer found ZERO elements with any [data-testid] attribute at all.
 *
 * ROOT CAUSE: the packaged desktop app (app.asar) is a stale build. Captured via
 * `stat -f %m` at investigation time (2026-08-13):
 *   /Applications/Mermaid Collab.app/Contents/Resources/app.asar
 *   mtime = 2026-08-11T20:23:51.481-05:00 (epoch ms 1786497831481)
 * That build predates the commit that last touched InboxSection.tsx, so the
 * shipped feature is simply not present in the deployed renderer. This asserts
 * the claim "the deployed app build is at least as new as its own Inbox-section
 * source" against the captured mtime — it is expected to stay RED until the
 * desktop app is rebuilt/redeployed after 2026-08-12T20:45:06-05:00.
 */

const REPO_ROOT = '/Users/benmaderazo/Code/claude-mermaid-collab';
const INBOX_SECTION_SRC = 'ui/src/components/layout/sidebar-tree/sections/InboxSection.tsx';
const CAPTURED_ASAR_MTIME_MS = 1786497831481;

describe('deployed desktop app vs Inbox sidebar source', () => {
  it('captured app.asar build is at least as new as the last InboxSection.tsx commit', () => {
    const lastCommitIso = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', INBOX_SECTION_SRC],
      { cwd: REPO_ROOT }
    )
      .toString()
      .trim();
    expect(lastCommitIso).not.toBe('');
    const lastCommitMs = new Date(lastCommitIso).getTime();

    expect(CAPTURED_ASAR_MTIME_MS).toBeGreaterThanOrEqual(lastCommitMs);
  });
});
