#!/usr/bin/env bash
# Apply the GitHub settings this repo relies on: merge settings and the `main` ruleset
# (scripts/main-ruleset.json). These live on GitHub, not in git, so cloning or creating a repo
# from the template does not copy them. Needs `gh` logged in with admin rights. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Auto-merge waits on the ruleset's required checks; merged branches are deleted.
# Only merge commits are allowed, so a wrong `gh pr merge` flag fails instead of silently squashing.
gh api -X PATCH "repos/$repo" \
  -F allow_auto_merge=true -F delete_branch_on_merge=true \
  -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false --silent
echo "Enabled auto-merge and delete-branch-on-merge, merge commits only, on $repo"

file=scripts/main-ruleset.json
name=$(jq -r .name "$file")
id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")

if [ -n "$id" ]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" --silent
  echo "Updated ruleset '$name' (#$id) on $repo"
else
  gh api -X POST "repos/$repo/rulesets" --input "$file" --silent
  echo "Created ruleset '$name' on $repo"
fi
