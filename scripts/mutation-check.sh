#!/usr/bin/env bash
# mutation-check.sh — prove a test is not a placebo by breaking the code and watching it go red,
# WITHOUT ever leaving a dirty tree.
#
#   scripts/mutation-check.sh [--neutralize <sed-expression|@patch-file|delete>] [--pre-state [<ref|sed-expression|@patch-file>]] <file> <mutation> <test-command...>
#
# Exit codes:
#   0  the test FAILED under mutation  → the test caught the regression (the desired outcome)
#   1  the test PASSED under mutation  → placebo: the test cannot detect this change
#   2  refused / could not restore     → the tree was dirty to begin with, or restore failed
#   3  test does not even pass on the unmutated tree (VACUOUS) → the mutated-run result is not evidence
#   4  neutralization ran and the test PASSED even with the subject deleted (VACUOUS FIXTURE) →
#      the test's assertion was never actually exercising the subject
#   5  --pre-state ran and the test PASSED against the file's state BEFORE the change under proof
#      (PRE-SATISFIED) → the assertion already held pre-change, so its current green is not
#      evidence the change did anything
#
# --pre-state [<ref|sed-expression|@patch-file>]:
#   Restores <file> to a state that predates the change under proof, runs the test command
#   against that pre-state, and reports exit 5 if it PASSES. The value is optional: with no
#   value, it defaults to `git merge-base HEAD master` for <file>'s repo. The value may be a
#   git ref (resolved via `git show <ref>:<file>`), a sed expression, or an `@patch-file` — the
#   same disambiguation is NOT guessed from syntax; a git ref is tried first via `cat-file -e`,
#   and everything else is either a patch (`@`-prefixed) or a sed expression.
#
# Guarantees:
#   - restores <file> on success, failure, exit, INT, and TERM (trap installed BEFORE mutating),
#     and after an optional neutralization pass and an optional pre-state pass
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

USAGE="usage: mutation-check.sh [--neutralize <sed-expression|@patch-file|delete>] [--pre-state [<ref|sed-expression|@patch-file>]] <file> <mutation> <test-command...>"

NEUTRALIZE=""
PRE_STATE_ENABLED=0
PRE_STATE=""
while :; do
  case "${1:-}" in
    --neutralize)
      [ "$#" -ge 2 ] || { echo "$USAGE" >&2; exit 2; }
      NEUTRALIZE="$2"; shift 2
      ;;
    --pre-state)
      PRE_STATE_ENABLED=1
      shift
      # Only consume $1 as the explicit ref/expr if there's still a token left over for
      # FILE, MUTATION, and >=1 test-command word — otherwise it's the default-filled form.
      if [ "$#" -gt 3 ]; then
        PRE_STATE="$1"; shift
      fi
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -lt 3 ]; then
  echo "$USAGE" >&2
  exit 2
fi

FILE="$1"
MUTATION="$2"
shift 2
# remaining args are the test command

GIT() { command git "$@"; }  # avoid aliased/wrapped git

# Apply an expression (sed expression, @patch-file, or "delete") to $FILE.
apply_change() {
  local expr="$1"
  if [ "$expr" = "delete" ]; then
    : > "$FILE"
  elif [ "${expr:0:1}" = "@" ]; then
    GIT -C "$REPO_ROOT" apply "${expr:1}"
  else
    # BSD (macOS) sed needs the empty '' after -i; GNU sed accepts -i with no arg. Use the
    # portable form: a backup suffix of '' via a separate arg works on BSD; delete any backup.
    sed -i.mcbak "$expr" "$FILE" && rm -f "$FILE.mcbak"
  fi
}

# Apply a pre-state expression (git ref, sed expression, or @patch-file) to $FILE.
# Disambiguated without guessing from syntax: @-prefixed is always a patch; otherwise probe
# whether it resolves as a ref for $FILE, and fall back to a sed expression if not.
apply_pre_state() {
  local expr="$1"
  if [ "${expr:0:1}" = "@" ]; then
    apply_change "$expr"
  elif GIT -C "$REPO_ROOT" cat-file -e "${expr}:${FILE}" 2>/dev/null; then
    GIT -C "$REPO_ROOT" show "${expr}:${FILE}" > "$FILE"
  else
    apply_change "$expr"
  fi
}

# The repo the target file lives in (works from any cwd, and for a worktree).
REPO_ROOT="$(cd "$(dirname "$FILE")" && GIT rev-parse --show-toplevel 2>/dev/null)" || {
  echo "mutation-check: '$FILE' is not inside a git repo" >&2
  exit 2
}

if [ "$PRE_STATE_ENABLED" -eq 1 ] && [ -z "$PRE_STATE" ]; then
  PRE_STATE="$(GIT -C "$REPO_ROOT" merge-base HEAD master 2>/dev/null)"
fi

status_porcelain() { GIT -C "$REPO_ROOT" status --porcelain --untracked-files=no; }

# 1. Refuse on a dirty tree — a mutation applied over existing changes cannot be cleanly unwound.
if [ -n "$(status_porcelain)" ]; then
  echo "mutation-check: refusing — working tree is not clean:" >&2
  status_porcelain >&2
  exit 2
fi

# 2. Run the test command on the UNMUTATED tree first — a test that doesn't even pass on
#    clean code cannot use a later failure as proof of anything. Runs before any mutation
#    or trap install, so it cannot dirty the tree.
"$@"
PRE_CODE=$?

# 3. Install the restore trap BEFORE mutating, so it fires on every exit path.
restore() {
  GIT -C "$REPO_ROOT" checkout -- "$FILE" 2>/dev/null || true
}
trap restore EXIT INT TERM

# 3b. Neutralization pass (opt-in): prove the test isn't vacuously passing even with the
#     subject deleted/neutralized. Runs before the real mutation, using the same restore.
NEUTRAL_CODE=""
if [ -n "$NEUTRALIZE" ]; then
  apply_change "$NEUTRALIZE" || { echo "mutation-check: neutralization failed to apply" >&2; exit 2; }
  "$@"
  NEUTRAL_CODE=$?
  restore
  if [ -n "$(status_porcelain)" ]; then
    echo "mutation-check: FAILED TO RESTORE — tree still dirty after neutralization restore:" >&2
    GIT -C "$REPO_ROOT" --no-pager diff -- "$FILE" >&2
    exit 2
  fi
fi

# 3c. Pre-state pass (opt-in): restore <file> to a state that predates the change under proof
#     and see whether the test already passed then — if so, the current green is not evidence
#     the change did anything. Runs before the real mutation, using the same restore.
PRE_STATE_CODE=""
if [ "$PRE_STATE_ENABLED" -eq 1 ]; then
  apply_pre_state "$PRE_STATE" || { echo "mutation-check: pre-state failed to apply" >&2; exit 2; }
  "$@"
  PRE_STATE_CODE=$?
  restore
  if [ -n "$(status_porcelain)" ]; then
    echo "mutation-check: FAILED TO RESTORE — tree still dirty after pre-state restore:" >&2
    GIT -C "$REPO_ROOT" --no-pager diff -- "$FILE" >&2
    exit 2
  fi
fi

# 4. Apply the mutation.
apply_change "$MUTATION" || { echo "mutation-check: mutation failed to apply" >&2; exit 2; }

# 5. Run the test command; capture its exit code (do not let it abort us).
"$@"
TEST_CODE=$?

# 6. Restore (the trap will also fire; git checkout -- is idempotent).
restore

# 7. Assert clean. A failed restore is an INCIDENT, never a silent pass.
if [ -n "$(status_porcelain)" ]; then
  echo "mutation-check: FAILED TO RESTORE — tree still dirty after restore:" >&2
  GIT -C "$REPO_ROOT" --no-pager diff -- "$FILE" >&2
  exit 2
fi

# 8. Report.
if [ "$PRE_CODE" -ne 0 ]; then
  echo "mutation-check: VACUOUS — test does not pass on the unmutated tree (PRE_CODE=$PRE_CODE); a mutated-run failure would not be evidence." >&2
  exit 3
elif [ -n "$NEUTRALIZE" ] && [ "$NEUTRAL_CODE" -eq 0 ]; then
  echo "mutation-check: VACUOUS FIXTURE — test PASSED with the subject neutralized (NEUTRAL_CODE=0); its assertion is pre-satisfied and would hold even if the feature were deleted." >&2
  exit 4
elif [ "$PRE_STATE_ENABLED" -eq 1 ] && [ "$PRE_STATE_CODE" -eq 0 ]; then
  echo "mutation-check: PRE-SATISFIED — test PASSED against the file's pre-state (PRE_STATE_CODE=0); its assertion already held before the change under proof, so the current green is not evidence the change did anything." >&2
  exit 5
elif [ "$TEST_CODE" -ne 0 ]; then
  echo "mutation-check: OK — test FAILED under mutation (the regression was caught)."
  exit 0
else
  echo "mutation-check: PLACEBO — test PASSED under mutation (it cannot detect this change)."
  exit 1
fi
