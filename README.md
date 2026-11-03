# ai-starter

Next.js (web) + Express (server), npm workspaces.

| Path      | Stack                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| `web/`    | Next.js App Router, TypeScript, Tailwind, shadcn/ui, Vercel AI SDK, zod, react-markdown, SWR |
| `server/` | Express 5, TypeScript, tsx                                                                   |

```bash
npm install
npm run dev          # web :3000 + server :4000
npm run dev:web
npm run dev:server
```

Server health: `GET http://localhost:4000/health`

```bash
npm test             # Vitest, all workspaces
npm run test:e2e     # Playwright (web)
npm run format       # Prettier
```

Pre-commit hook (lefthook, installed by `npm install`): Prettier + ESLint on staged files, then typecheck + `npm test`. Commit is blocked if any step fails.

Pre-push hook: `npm run test:e2e`; push is blocked if E2E fails. `npm install` also downloads Playwright's Chromium (`postinstall`).

API contract: `server/openapi.yaml`. Claude Code config (hooks, subagents): `.claude/`.

## Recommended agent skills

`AGENTS.md` and `docs/agents/` follow the conventions of [mattpocock/skills](https://github.com/mattpocock/skills) (`/to-spec`, `/to-tickets`, `/triage`, `/tdd`, `/domain-modeling`, `/codebase-design`, …). Install them for your agent:

```bash
npx skills add mattpocock/skills -g   # any agent (Codex, Cursor, Copilot, Gemini CLI, …)
```

Claude Code users get prompted to install the plugin from `.claude/settings.json` when they trust the folder.

Project-specific skills go in `.agents/skills/` (committed). Claude Code only reads `.claude/skills/`, so link it once: `ln -s ../.agents/skills .claude/skills`.

## New project from this template

```bash
gh repo create my-app --template JasonJTW/starter --clone --private
cd my-app && npm install
claude setup-token                                    # Claude Pro/Max: prints a token
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R JasonJTW/my-app
```

Until the secret is set, the Claude workflows fail with an error naming it (fork PRs skip review, since forks never receive secrets). CI (`.github/workflows/ci.yml`) needs no setup.
