## Commands

- `npm run dev`: web :3000 + server :4000
- `npm test`: Vitest in every workspace (`npm test -w web` / `-w server` for one)
- `npm run test:e2e`: Playwright against `web` (starts `next dev` itself)
- Postgres (pgvector + pg_trgm, ADR-0001): `npm run db:up` starts the one `docker compose` service every worktree shares (project name `ragchat`, host port `POSTGRES_PORT`, default 5433); `npm run db:migrate` applies migrations to `DATABASE_URL` (the server also migrates on startup, so `npm run dev` needs Postgres up). Schema in `server/src/db/schema.ts`; after changing it run `npm run db:generate -w server` and commit `server/drizzle/`. After changing `EMBEDDING_MODEL` (same 1536 dimensions, `EMBEDDING_DIMENSIONS`), run `npm run reembed -w server`: rows embedded by another model drop out of every search until it re-embeds them (facts, passages, entities, aliases; resumable).
- Presidio Analyzer (de-identification, ADR-0004): `npm run presidio:up` starts the shared sidecar (host port `PRESIDIO_PORT`, default 5002). `npm run dev` needs it (and `PSEUDONYM_ENCRYPTION_KEY`) for the team workspace, which otherwise refuses input. Tests, E2E and CI use the local analyzer instead (`PII_ANALYZER=local`, `server/src/pii-analyzer.ts`); with the sidecar up, `PRESIDIO_URL=http://localhost:5002 npm test -w server` also runs `pii-analyzer.test.ts` against it.
- Production (`docs/deploy.md`): `docker-compose.prod.yml` (project `ragchat-prod`, apart from the dev `ragchat` one) builds `server/Dockerfile` and `web/Dockerfile` from the repo root and adds `cloudflared` under the `tunnel` profile. `scripts/backup.sh` / `scripts/restore.sh` run `pg_dump`/`pg_restore` inside the Postgres container (`BACKUP_PG_CONTAINER`); `server/src/backup.test.ts` runs them against the test Postgres. To try the stack locally, use another project name (`docker compose -p ragchat-prod-check -f docker-compose.prod.yml up -d --build --wait` with `POSTGRES_PASSWORD` and `WEB_PORT` set) and `down -v --rmi local` afterwards.
- Server tests use real Postgres: each `npm test -w server` run creates its own `ragchat_test_<random>` database on the server `DATABASE_URL` names (shell, then root `.env`, else the compose default), migrates it, and drops it at the end, so worktrees run tests in parallel safely. A local run starts the compose service if it is down; CI uses a service container. All test files in one run share that database: isolate tests by creating a workspace per test, never by truncating tables.
- `npm run lint`, `npm run typecheck`: every workspace (ESLint + `tsc`)
- `npm run format`: Prettier
- `npm run setup:repo`: apply the GitHub repo settings (auto-merge on, delete branch on merge) and the `scripts/main-ruleset.json` ruleset (needs admin `gh`). **Run once after creating a repo from this starter.**
- Env: one `.env` in the repo root (template `.env.example`); the server loads it on `dev` and `start`. Add every new variable to `.env.example`.
- `npm run setup:worktree`: link the main checkout's `.env` into a new git worktree (creating it from `.env.example` if missing) and run `npm ci`. T3 Code runs it on worktree creation; run it yourself when a worktree lacks `.env` or `node_modules`.
- Pull starter updates: `git remote add starter https://github.com/JasonJTW/starter.git` (once per clone), then `git fetch starter` and `git merge starter/main` on a branch, and open a PR. Shared history makes the merge bring in only new starter commits. A squash merge of that PR breaks the link, so merge it with a merge commit.
- CI (`.github/workflows/ci.yml`) runs a production dependency audit, lint, typecheck, test, build, and E2E on every PR and push to `main`.

## Conventions

- Sign-in: the server asks `identify(req)` / `callerOf(req)` (`server/src/auth.ts`, `server/src/workspaces.ts`); knowledge base routes go through `requireMember` in `app.ts`. Tests and E2E fake Clerk with `STUB_AUTH=1` and a `stub_session` cookie (`stubSession()` in `server/src/stub-auth.ts`, `signIn()` in `web/e2e/sign-in.ts`; E2E specs start signed in as a 成員).
- Tests sit next to the code as `*.test.ts(x)`. Server tests import `app` from `server/src/app.ts` and hit it with supertest; `server/src/index.ts` only calls `listen`.
- E2E specs live in `web/e2e/*.spec.ts`; Vitest ignores that folder.
- De-identification wraps the agent (`server/src/pseudonyms.ts`): text from a caller is pseudonymised before any model, embedding or table sees it (`chat.ts` for messages, the input subgraph's `deidentify` node for files, `app.ts` for edits), and re-identified on the way out (the chat stream, and every JSON response of the knowledge base routes). New text entering, or a new route returning stored text, must go through it. Server tests for it use a `team` workspace; `guest` ones are never de-identified.
- The server calls models only through `server/src/models.ts` (`chatModel(purpose)`, `embeddings()`; LangChain, ADR-0002). Tests get fakes from `installStubModels()` (`server/src/stub-models.ts`), installed for every server test file and by `STUB_MODELS=1`.
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
- Start: `npm run dev` (chat `localhost:3000/` for signed-in 成員 only, files attached there or posted to `/api/sources`; Next rewrites `/api/*` to the server on :4000).
- Full suite: `npm run lint && npm run typecheck && npm test && npm run test:e2e` (no LLM calls; `@live` tests excluded). E2E starts its own web :3100 + server :4100 (override with `E2E_WEB_PORT`/`E2E_SERVER_PORT`) on its own `ragchat_e2e_<random>` database, dropped afterwards, never touching a running `npm run dev`.
- Live tests: `npm run test:live` (needs `AI_GATEWAY_API_KEY`; `JEV_API_KEY` for Jev, and the Presidio sidecar): first the server's `*.live.test.ts` (Vitest, `vitest.live.config.ts`, its own database), then the Playwright `@live` specs. The team FAQ eval (`server/src/team-faq.ts` questions + grader, `team-faq.live.test.ts` harness, ticket #40) seeds the 示範資料 through the real input path once per run and writes threshold measurements to `.scratch/kb-chatbot/evidence/40/report.json`. Its 10 questions are PROVISIONAL until the team's real ones replace them.
- Env (root `.env`, see `.env.example`): `AI_GATEWAY_API_KEY`, `JEV_API_KEY` (Jev subject check; optional, live tests need it), `CHAT_MODEL` (e.g. `openai/gpt-5-mini`), `EXTRACT_MODEL`/`GUEST_MODEL` (optional, default `CHAT_MODEL`), `EMBEDDING_MODEL`, `DATABASE_URL`/`POSTGRES_PORT` (optional), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`/`CLERK_MEMBER_ORG_ID` (Clerk sign-in; web loads the root `.env` too); web reads `SERVER_URL` (default `http://localhost:4000`).
