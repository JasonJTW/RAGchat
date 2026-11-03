## Commands

- `npm run dev`: web :3000 + server :4000
- `npm test`: Vitest in every workspace (`npm test -w web` / `-w server` for one)
- `npm run test:e2e`: Playwright against `web` (starts `next dev` itself)
- `npm run lint`, `npm run typecheck`: every workspace (ESLint + `tsc`)
- `npm run format`: Prettier
- CI (`.github/workflows/ci.yml`) runs a production dependency audit, lint, typecheck, test, build, and E2E on every PR and push to `main`.

## Conventions

- Tests sit next to the code as `*.test.ts(x)`. Server tests import `app` from `server/src/app.ts` and hit it with supertest; `server/src/index.ts` only calls `listen`.
- E2E specs live in `web/e2e/*.spec.ts`; Vitest ignores that folder.
- The pre-commit hook (`lefthook.yml`) formats and lints staged files, then runs `npm run typecheck` and `npm test`. The pre-push hook refuses pushes to `main`, then runs `npm run test:e2e`. Changes reach `main` through a PR: CI and the Claude reviews are required checks. Fix failures; never bypass either hook with `--no-verify`.
- After opening a PR, enable auto-merge: `gh pr merge --auto --squash <PR>`. GitHub then merges it once the required checks pass. Skip this for draft PRs, or when the user says to hold the merge.
- If auto-merge stalls on a failing check, fix the failure and push. Never merge manually past a red check.
- A behaviour change ships with a test.
- `server/openapi.yaml` is the API contract. Update it in the same change as any route.

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

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

## POC: kb-chatbot

- Spec `.scratch/kb-chatbot/spec.md`; tickets `.scratch/kb-chatbot/issues/`; fixtures and answer key `.scratch/kb-chatbot/fixtures/`.
- Start: `npm run dev` (chat `localhost:3000/`, admin `localhost:3000/admin`; Next rewrites `/api/*` to the server on :4000).
- Full suite: `npm run lint && npm run typecheck && npm test && npm run test:e2e` (no LLM calls; `@live` tests excluded).
- Live tests: `npm run test:live` (Playwright `@live` tests against the real LLM; needs `OPENAI_API_KEY`).
- Env (`server/.env`, see `server/.env.example`): `OPENAI_API_KEY`, `CHAT_MODEL`, `EMBEDDING_MODEL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`; web reads `SERVER_URL` (default `http://localhost:4000`).
