## Commands

- `npm run dev`: web :3000 + server :4000
- `npm test`: Vitest in every workspace (`npm test -w web` / `-w server` for one)
- `npm run test:e2e`: Playwright against `web` (starts `next dev` itself)
- `npm run lint`, `npm run typecheck`: every workspace (ESLint + `tsc`)
- `npm run format`: Prettier
- `npm run setup:repo`: apply the GitHub repo settings (auto-merge on, delete branch on merge) and the `scripts/main-ruleset.json` ruleset (needs admin `gh`). **Run once after creating a repo from this starter.**
- Env: one `.env` in the repo root (template `.env.example`); the server loads it on `dev` and `start`. Add every new variable to `.env.example`.
- `npm run setup:worktree`: link the main checkout's `.env` into a new git worktree (creating it from `.env.example` if missing) and run `npm ci`. T3 Code runs it on worktree creation; run it yourself when a worktree lacks `.env` or `node_modules`.
- Pull starter updates: `git remote add starter https://github.com/JasonJTW/starter.git` (once per clone), then `git fetch starter` and `git merge starter/main` on a branch, and open a PR. Shared history makes the merge bring in only new starter commits. A squash merge of that PR breaks the link, so merge it with a merge commit.
- CI (`.github/workflows/ci.yml`) runs a production dependency audit, lint, typecheck, test, build, and E2E on every PR and push to `main`.

## Conventions

- Tests sit next to the code as `*.test.ts(x)`. Server tests import `app` from `server/src/app.ts` and hit it with supertest; `server/src/index.ts` only calls `listen`.
- E2E specs live in `web/e2e/*.spec.ts`; Vitest ignores that folder.
- The pre-commit hook (`lefthook.yml`) formats and lints staged files, then runs `npm run typecheck` and `npm test`. The pre-push hook refuses pushes to `main`, then runs `npm run test:e2e`. Changes reach `main` through a PR: CI and the Claude reviews are required checks, enforced by the `main` ruleset. The ruleset and merge settings are GitHub settings, not git content, so they are absent in every new clone or template copy until `npm run setup:repo` runs. Without it nothing blocks a merge. If you add or rename a required job, update `scripts/main-ruleset.json` and re-run it. Fix failures; never bypass either hook with `--no-verify`.
- After opening a PR, enable auto-merge: `gh pr merge --auto --merge <PR>`. GitHub then merges it once the required checks pass. Skip this for draft PRs, or when the user says to hold the merge.
- If auto-merge stalls on a failing check, fix the failure and push. Never merge manually past a red check.
- A behaviour change ships with a test.
- `server/openapi.yaml` is the API contract. Update it in the same change as any route.
- Every worktree, including a scratch one, gets its own `node_modules`: work in the existing worktree with `git switch`, or run `npm ci` in the new one. A symlinked `node_modules` resolves workspace packages to the other checkout and breaks both when either reinstalls.

## Design: deep modules

Build **deep modules**: small interface, large implementation. Each module hides one decision or complexity behind a narrow API. Callers know the interface only.

- Extend before adding. Find the module that owns the concept and deepen it. Create a new module only for a new concept.
- Interface = everything a caller must know (signature, call order, errors, invariants). Keep it minimal. Push complexity inside.
- A function or class whose interface is as complex as its body is shallow. When you touch it, inline it or merge it into its neighbour.
- Extract shared code on the third occurrence, not before.
- Group by concept (**locality**): change, bugs, and knowledge about one concept live in one place.
- Put the **seam** where behaviour varies (I/O, vendors, config). Test through the interface.
- Components: one responsibility, explicit inputs and outputs. Compose small components. Variation comes from composition, not flag parameters.

Designing or refactoring module boundaries → use the `codebase-design` skill.

## Review

- Reviewing a change → `docs/agents/code-review.md`.
- Change touches routes, auth, secrets, LLM input, or workflows → also `docs/agents/security-review.md`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`JasonJTW/RAGchat`, via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

## POC: kb-chatbot

- Spec `.scratch/kb-chatbot/spec.md`; tickets `.scratch/kb-chatbot/issues/`; fixtures and answer key `.scratch/kb-chatbot/fixtures/`.
- Start: `npm run dev` (chat `localhost:3000/`, admin `localhost:3000/admin`; Next rewrites `/api/*` to the server on :4000).
- Full suite: `npm run lint && npm run typecheck && npm test && npm run test:e2e` (no LLM calls; `@live` tests excluded). E2E starts its own web :3100 + server :4100, never touching a running `npm run dev`.
- Live tests: `npm run test:live` (Playwright `@live` tests against the real LLM; needs `AI_GATEWAY_API_KEY`).
- Env (root `.env`, see `.env.example`): `AI_GATEWAY_API_KEY`, `JEV_API_KEY` (Jev subject check; optional, live tests need it), `CHAT_MODEL` (e.g. `openai/gpt-5-mini`), `EMBEDDING_MODEL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`; server reads `DATA_DIR` (default `server/data/`); web reads `SERVER_URL` (default `http://localhost:4000`).
