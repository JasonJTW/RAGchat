# RAGchat

Knowledge-base chatbot POC for megaweaving (大量交織). Users ask questions in Chinese on the chat page; the bot answers from documents an admin has uploaded and lists its sources under each answer. Questions the documents don't cover get a fixed refusal with the support email.

- Chat: `http://localhost:3000/` (no login)
- Admin: `http://localhost:3000/admin` (log in to upload, list, and delete documents)

Spec and acceptance criteria: `.scratch/kb-chatbot/spec.md`; tickets: `.scratch/kb-chatbot/issues/`.

## Features

- **Upload**: `.pdf`, `.md`, `.txt`, up to 10 files at a time; other formats show 「不支援的檔案格式」. Scanned PDFs (no text layer) get 0 chunks and are marked 「無法抽出文字」.
- **Chunking**: markdown splits on the heading hierarchy, each chunk prefixed with its `file › H1 › H2 › H3` path; PDFs split by page; txt detects Q/A pairs or splits on blank lines and sentences. 800-token limit; tables are never split mid-row. Details: `.scratch/kb-chatbot/md-chunking-report.md`.
- **Hybrid retrieval**: embedding cosine top 20 + BM25 (Chinese character bigrams) top 20, merged with RRF; the top 6 chunks go to the LLM.
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
- Documents, chunks, and embeddings are stored as JSON in `server/data/` (override with `DATA_DIR`) and loaded into memory at startup. Changing `EMBEDDING_MODEL` re-embeds every document on the next start.
- The admin has a single username/password from env vars. Login issues an httpOnly session cookie held in memory, so a server restart logs the admin out.
- API contract: `server/openapi.yaml`.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the variables below
npm run dev            # web :3000 + server :4000
```

| Variable             | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key                                    |
| `CHAT_MODEL`         | Chat model, default `openai/gpt-5-mini`                  |
| `EMBEDDING_MODEL`    | Embedding model, default `openai/text-embedding-3-small` |
| `ADMIN_USERNAME`     | Admin username, default `admin`                          |
| `ADMIN_PASSWORD`     | Admin password                                           |

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
