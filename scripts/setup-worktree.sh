#!/usr/bin/env bash
# Prepare a checkout to run: make sure the main checkout has a `.env`, link it into this
# worktree, and install dependencies. `.env` and `node_modules` are gitignored, so a new
# git worktree starts without them. Safe to re-run; in the main checkout it only creates `.env`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
main=$(git worktree list --porcelain | awk 'NR==1 {print $2}')

# The main checkout's `.env` is the single copy every worktree links to.
if [ ! -f "$main/.env" ] && [ -f .env.example ]; then
  cp .env.example "$main/.env"
  echo "Created $main/.env from .env.example"
fi

if [ "$PWD" != "$main" ]; then
  # Replace a dangling link left by a `.env` that was missing when this worktree was set up.
  if [ -L .env ] && [ ! -e .env ]; then rm .env; fi
  if [ -f "$main/.env" ] && [ ! -e .env ]; then
    ln -s "$main/.env" .env
    echo "Linked .env -> $main/.env"
  fi
  npm ci
fi

if [ -f "$main/.env" ]; then
  empty=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*$' "$main/.env" | cut -d= -f1 || true)
  if [ -n "$empty" ]; then
    echo "These keys in $main/.env are empty; fill them in:"
    echo "$empty" | sed 's/^/  /'
  fi
else
  echo "No .env in $main (and no .env.example to copy); skipping the link."
fi
