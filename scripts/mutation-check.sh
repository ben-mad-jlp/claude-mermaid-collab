#!/usr/bin/env bash
# mutation-check.sh — prove a test is not a placebo by breaking the code and watching it go red,
# WITHOUT ever leaving a dirty tree.
#
#   scripts/mutation-check.sh <file> <sed-expression|@patch-file> <test-command...>
#
# Exit codes:
#   0  the test FAILED under mutation  → the test caught the regression (the desired outcome)
#   1  the test PASSED under mutation  → placebo: the test cannot detect this change
#   2  refused / could not restore     → the tree was dirty to begin with, or restore failed
#
# Guarantees:
#   - restores <file> on success, failure, exit, INT, and TERM (trap installed BEFORE mutating)
#   - restore is `git checkout --` on the single named file ONLY — never cp, never mv, never
#     `git reset`, never `git checkout .` (no blast radius onto unrelated work)
#   - refuses to start on a dirty tree (a probe on a dirty tree cannot be unwound)
#   - asserts the tree is clean after restoring; a failed restore is exit 2, never a silent pass
#
# Caveat (documented, not silently ignored): if the mutation makes <file> syntactically invalid,
# the test command fails to PARSE, which also reads as "test failed" (exit 0) and is a FALSE PASS
# for the placebo check. Prefer a mutation that flips behaviour while keeping the file parseable
# (e.g. invert a boolean, swap an operator) so the failure is an ASSERTION, not a parse error.

set -uo pipefail  # NOT -e: a failing test command must not abort the script before restore

if [ "$#" -lt 3 ]; then
  echo "usage: mutation-check.sh <file> <sed-expression|@patch-file> <test-command...>" >&2
  exit 2
fi

FILE="$1"
MUTATION="$2"
shift 2
# remaining args are the test command

GIT() { command git "$@"; }  # avoid aliased/wrapped git

# The repo the target file lives in (works from any cwd, and for a worktree).
REPO_ROOT="$(cd "$(dirname "$FILE")" && GIT rev-parse --show-toplevel 2>/dev/null)" || {
  echo "mutation-check: '$FILE' is not inside a git repo" >&2
  exit 2
}

status_porcelain() { GIT -C "$REPO_ROOT" status --porcelain --untracked-files=no; }

# 1. Refuse on a dirty tree — a mutation applied over existing changes cannot be cleanly unwound.
if [ -n "$(status_porcelain)" ]; then
  echo "mutation-check: refusing — working tree is not clean:" >&2
  status_porcelain >&2
  exit 2
fi

# 2. Install the restore trap BEFORE mutating, so it fires on every exit path.
restore() {
  GIT -C "$REPO_ROOT" checkout -- "$FILE" 2>/dev/null || true
}
trap restore EXIT INT TERM

# 3. Apply the mutation.
if [ "${MUTATION:0:1}" = "@" ]; then
  GIT -C "$REPO_ROOT" apply "${MUTATION:1}" || { echo "mutation-check: patch did not apply" >&2; exit 2; }
else
  # BSD (macOS) sed needs the empty '' after -i; GNU sed accepts -i with no arg. Use the
  # portable form: a backup suffix of '' via a separate arg works on BSD; delete any backup.
  sed -i.mcbak "$MUTATION" "$FILE" && rm -f "$FILE.mcbak" || { echo "mutation-check: sed mutation failed" >&2; exit 2; }
fi

# 4. Run the test command; capture its exit code (do not let it abort us).
"$@"
TEST_CODE=$?

# 5. Restore (the trap will also fire; git checkout -- is idempotent).
restore

# 6. Assert clean. A failed restore is an INCIDENT, never a silent pass.
if [ -n "$(status_porcelain)" ]; then
  echo "mutation-check: FAILED TO RESTORE — tree still dirty after restore:" >&2
  GIT -C "$REPO_ROOT" --no-pager diff -- "$FILE" >&2
  exit 2
fi

# 7. Report. Test FAILED under mutation → the test caught it (good). Test PASSED → placebo.
if [ "$TEST_CODE" -ne 0 ]; then
  echo "mutation-check: OK — test FAILED under mutation (the regression was caught)."
  exit 0
else
  echo "mutation-check: PLACEBO — test PASSED under mutation (it cannot detect this change)."
  exit 1
fi
