#!/usr/bin/env bash
# SessionEnd hook — prune MERGED + CLEAN worktrees under .claude/worktrees/ so they
# stop accumulating (the EnterWorktree/ExitWorktree "keep" leftovers).
#
# Safe by construction: only removes a worktree whose branch is (a) fully merged into
# the default branch, (b) has NO uncommitted changes, and (c) is 0 commits ahead of
# the base. Anything with unmerged work or a dirty tree is left untouched. Never
# touches .collab/agent-sessions/ (the daemon's own worktrees).
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$repo" 2>/dev/null || exit 0
wtdir="$repo/.claude/worktrees"
[ -d "$wtdir" ] || exit 0

base="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
[ -n "$base" ] || base=master

removed=0
for wt in "$wtdir"/*/; do
  [ -d "$wt" ] || continue
  br="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)" || continue
  [ "$br" = "HEAD" ] && continue                                        # detached → keep
  [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ] && continue   # dirty → keep
  ahead="$(git rev-list --count "$base".."$br" 2>/dev/null || echo 1)"
  [ "$ahead" = "0" ] || continue                                        # unmerged commits → keep
  git branch --merged "$base" --format='%(refname:short)' 2>/dev/null | grep -qxF "$br" || continue
  if git worktree remove "$wt" 2>/dev/null; then
    git branch -d "$br" 2>/dev/null
    removed=$((removed + 1))
  fi
done
git worktree prune 2>/dev/null

if [ "$removed" -gt 0 ]; then
  printf '{"systemMessage":"Pruned %d merged worktree(s) from .claude/worktrees/"}\n' "$removed"
fi
exit 0
