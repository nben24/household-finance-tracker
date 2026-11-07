#!/usr/bin/env bash
# Copies main to the public showcase repo: one public commit per new commit
# here, with the same code, message and author. Public history starts from the
# first sync, so nothing older is ever sent.
#
# Before sending, every commit's code and message is checked against a local
# deny list (.git/public-denylist, one term per line; it is never committed).
# Any match stops the sync and shows where it is.
#
#   scripts/sync-public.sh [commit]   # default: main; run by .githooks/pre-push
#
# Setup, once per clone:
#   git remote add public <public repo URL>
#   git config core.hooksPath .githooks
set -euo pipefail

remote=public
branch=main
target=$(git rev-parse "${1:-$branch}")
git_dir=$(git rev-parse --git-dir)
denylist="$git_dir/public-denylist"

fail() { echo "Public sync: $*" >&2; exit 1; }

git remote get-url "$remote" >/dev/null 2>&1 || fail "no '$remote' remote; nothing sent."
[ -s "$denylist" ] || fail "no deny list at $denylist; nothing sent."
pattern=$(grep -vE '^[[:space:]]*(#|$)' "$denylist" | paste -sd'|' -)
[ -n "$pattern" ] || fail "the deny list is empty; nothing sent."

check() {
  local commit=$1
  if git grep -I -i -n -w -E "$pattern" "$commit" -- . ':!LICENSE' >&2; then
    fail "commit $(git rev-parse --short "$commit") has the lines above, which match the deny list; nothing sent."
  fi
  if git log -1 --format=%B "$commit" | grep -i -w -E "$pattern" >&2; then
    fail "the message of commit $(git rev-parse --short "$commit") matches the deny list; nothing sent."
  fi
}

# Public commits are made here from each private commit's code.
publish() {
  local commit=$1 parent=$2 message=${3:-}
  GIT_AUTHOR_NAME=$(git log -1 --format=%an "$commit") \
  GIT_AUTHOR_EMAIL=$(git log -1 --format=%ae "$commit") \
  GIT_AUTHOR_DATE=$(git log -1 --format=%aI "$commit") \
  GIT_COMMITTER_NAME=$(git log -1 --format=%cn "$commit") \
  GIT_COMMITTER_EMAIL=$(git log -1 --format=%ce "$commit") \
  GIT_COMMITTER_DATE=$(git log -1 --format=%cI "$commit") \
    git commit-tree "$commit^{tree}" ${parent:+-p "$parent"} -F <(if [ -n "$message" ]; then echo "$message"; else git log -1 --format=%B "$commit"; fi)
}

last=$(git config --get public.lastSynced || true)
head=$(git config --get public.head || true)

if [ -z "$last" ]; then
  # First sync: the public repo starts with today's code as a single commit.
  check "$target"
  head=$(publish "$target" "" "Household Finance Tracker")
else
  git merge-base --is-ancestor "$last" "$target" ||
    fail "main no longer contains the last synced commit ($last); nothing sent."
  [ "$last" != "$target" ] || exit 0
  for commit in $(git rev-list --reverse --first-parent "$last..$target"); do
    check "$commit"
  done
  for commit in $(git rev-list --reverse --first-parent "$last..$target"); do
    head=$(publish "$commit" "$head")
  done
fi

git push --no-verify --quiet "$remote" "$head:refs/heads/$branch"
git config public.lastSynced "$target"
git config public.head "$head"
echo "Public repo updated to $(git rev-parse --short "$target")."
