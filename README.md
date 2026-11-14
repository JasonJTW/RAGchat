# RAGchat

Knowledge-base chatbot POC for megaweaving (大量交織). Users ask questions in Chinese on the chat page; the bot answers from documents an admin has uploaded and lists its sources under each answer. Questions the documents don't cover get a fixed refusal with the support email.

- Chat: `http://localhost:3000/` (sign in with Clerk; only members of the MegaWeaving Organization get in)
- Files: attach `.md`, `.txt`, `.pdf` or `.docx` to a chat message (「附加檔案」), or `POST /api/sources`; each file becomes a 來源 and a 提案 to confirm

Production (Docker Compose on Ubuntu behind Cloudflare Tunnel, daily backups, restore): [`docs/deploy.md`](docs/deploy.md).

Spec and acceptance criteria: `.scratch/kb-chatbot/spec.md`; tickets: `.scratch/kb-chatbot/issues/`.

## Features

- **Input**: a chat message's attachments and `POST /api/sources` share one LangGraph input subgraph (`server/src/agent/input.ts`): 轉文字 → 切 chunk → 抽取 (per chunk; meeting transcripts and repo weekly reports get a hint) → 建立提案. `.pdf`, `.md`, `.txt`, `.docx`, up to 10 files of 5 MB at a time; other formats show 「不支援的檔案格式」. Scanned PDFs (no text layer) are reported 「無法抽出文字」. Nothing enters the knowledge base until a 成員 confirms the proposal (items can be unticked: 「確認所選」).
- **Chunking**: markdown splits on the heading hierarchy, each chunk prefixed with its `file › H1 › H2 › H3` path; PDFs split by page; txt detects Q/A pairs or splits on blank lines and sentences. 800-token limit; tables are never split mid-row. Details: `.scratch/kb-chatbot/md-chunking-report.md`.
- **Retrieval**: the 6 best confirmed facts (pgvector cosine) and the 2 best passages of confirmed file sources (pgvector cosine top 20 + pg_trgm keyword top 20, merged with RRF) go to the LLM.
- **Citations**: markdown shows `file › heading path`, PDF shows `file › 第 N 頁`, txt shows `file › opening of the paragraph`; clicking a citation expands the source text.
- **Refusal**: if the best cosine is below 0.30 the server refuses without calling the LLM; otherwise the LLM answers only from the chunks and, when they don't cover the question, replies 「這個問題我無法回答，請來信客服 support@megaweaving.example。」 with no citations.
- **Follow-ups and new chat**: follow-up questions are rewritten into standalone questions before retrieval; the 「新對話」 button clears the conversation (history lives only in the browser tab).
- **Streaming**: answers stream word by word; the first word appears within 5 s.

## Architecture

npm workspaces:

| Path      | Stack                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| `web/`    | Next.js App Router, TypeScript, Tailwind, shadcn/ui, Vercel AI SDK, zod, react-markdown, SWR |
| `server/` | Express 5, TypeScript, tsx, Vercel AI SDK, pdfjs-dist, js-tiktoken                           |

- Next rewrites `/api/*` to the server (`SERVER_URL`, default `http://localhost:4000`).
- All chat and embedding calls go through the Vercel AI SDK and the Vercel AI Gateway. Models are `<provider>/<model>` strings (`server/src/models.ts`); switching models only changes an env var.
- 來源, their chunks (`source_chunks`), facts and proposals live in Postgres (pgvector + pg_trgm, ADR-0001); schema in `server/src/db/schema.ts`.
- Sign-in is Clerk (`@clerk/nextjs` on the web, `@clerk/express` on the server). Members of the Organization `CLERK_MEMBER_ORG_ID` are 成員 and work in the team workspace; other signed-in users are 訪客 and are told guest trials are not open yet. Tests and E2E fake sign-in with `STUB_AUTH=1` and a `stub_session` cookie, which both apps ignore while `CLERK_SECRET_KEY` is set or in production.
- API contract: `server/openapi.yaml`.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the variables below
npm run dev            # web :3000 + server :4000
```

| Variable                                                | Purpose                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `AI_GATEWAY_API_KEY`                                    | Vercel AI Gateway key                                    |
| `CHAT_MODEL`                                            | Chat model, default `openai/gpt-5-mini`                  |
| `EMBEDDING_MODEL`                                       | Embedding model, default `openai/text-embedding-3-small` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk keys (web and server read both)                    |
| `CLERK_MEMBER_ORG_ID`                                   | Clerk Organization whose members are 成員                |

Sample documents: `.scratch/kb-chatbot/fixtures/upload/`; expected answers: `.scratch/kb-chatbot/fixtures/answer-key.md`.

## Testing

```bash
npm test             # Vitest, all workspaces (no LLM calls)
npm run test:e2e     # Playwright; starts its own web :3100 + server :4100, never touches a running dev server
npm run test:live    # @live tests against the real LLM; needs AI_GATEWAY_API_KEY
npm run lint && npm run typecheck
```

Git hooks (lefthook, installed by `npm install`):

- pre-commit: Prettier + ESLint on staged files, then typecheck and `npm test`.
- pre-push: refuses pushes to `main`, then runs `npm run test:e2e`.

CI (`.github/workflows/ci.yml`) runs a dependency audit, lint, typecheck, test, build, and E2E on every PR and push to `main`. All changes reach `main` through a PR.

## Conventions

`AGENTS.md` holds the commands, conventions, and design principles (deep modules). `docs/agents/` covers code review, the issue tracker, and more; `docs/adr/` holds architecture decisions.

This repo was created from [JasonJTW/starter](https://github.com/JasonJTW/starter); see `AGENTS.md` for pulling starter updates.
