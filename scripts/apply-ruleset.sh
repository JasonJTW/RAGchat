#!/usr/bin/env bash
# Create or update the `main` ruleset from scripts/main-ruleset.json on the current repo.
# Rulesets are GitHub settings, not git content: cloning or templating a repo does not copy them.
# Needs `gh` logged in with admin rights on the repo. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
file=scripts/main-ruleset.json
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
name=$(jq -r .name "$file")
id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")

if [ -n "$id" ]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" --silent
  echo "Updated ruleset '$name' (#$id) on $repo"
else
  gh api -X POST "repos/$repo/rulesets" --input "$file" --silent
  echo "Created ruleset '$name' on $repo"
fi
