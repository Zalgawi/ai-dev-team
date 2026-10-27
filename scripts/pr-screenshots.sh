#!/usr/bin/env bash
# Uploads screenshots for a pull request and prints Markdown to paste into it.
#
#   scripts/pr-screenshots.sh <pr-branch> <image>...
#
# Images go to the `pr-screenshots` branch (never merged, so main stays
# small), under a folder named after the PR branch, and are linked from
# raw.githubusercontent.com. The repo is public: only add screenshots that
# are safe to publish (no uploaded personal media, secrets or private data).
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <pr-branch> <image>..." >&2
  exit 1
fi

pr_branch="$1"; shift
folder="${pr_branch//\//-}"
repo_root="$(git rev-parse --show-toplevel)"
slug="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
work="$(mktemp -d)"
trap 'git -C "$repo_root" worktree remove --force "$work/tree" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

cd "$repo_root"
if git ls-remote --exit-code --heads origin pr-screenshots >/dev/null 2>&1; then
  git fetch -q origin pr-screenshots
  git worktree add -q -B pr-screenshots "$work/tree" origin/pr-screenshots
else
  git worktree add -q --orphan -b pr-screenshots "$work/tree"
  printf '# PR screenshots\n\nImages linked from pull request descriptions. Never merged into main.\n' > "$work/tree/README.md"
fi

mkdir -p "$work/tree/$folder"
names=()
for image in "$@"; do
  name="$(basename "$image" | tr ' ' '-')"
  cp "$image" "$work/tree/$folder/$name"
  names+=("$name")
done

git -C "$work/tree" add -A
git -C "$work/tree" commit -q -m "Screenshots for $pr_branch" || true
git -C "$work/tree" push -q origin pr-screenshots

for name in "${names[@]}"; do
  label="${name%.*}"
  printf '![%s](https://raw.githubusercontent.com/%s/pr-screenshots/%s/%s)\n' "${label//-/ }" "$slug" "$folder" "$name"
done
