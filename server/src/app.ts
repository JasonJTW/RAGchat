import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Response,
} from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { authentication, identify } from "./auth.js";
import { inputFiles, MAX_FILE_BYTES } from "./agent/input.js";
import { attachedFiles, streamReply } from "./chat.js";
import {
  listConversations,
  mayContinue,
  readConversation,
} from "./conversations.js";
import {
  confirmProposal,
  type DecisionError,
  pendingProposals,
  type Proposal,
  rejectProposal,
  type Stopped,
} from "./knowledge-base.js";
import { passesTurnstile } from "./turnstile.js";
import {
  GUEST_LIMITS,
  type Refusal,
  resetTrial,
  trialOf,
  useAllowance,
  verifyGuest,
} from "./trial.js";
import { callerOf, type Caller } from "./workspaces.js";

export const app = express();
const EXAMPLE_UPLOAD = "meeting-2026-11-12.txt";
const EXAMPLE_TEXT = readFileSync(
  path.join(import.meta.dirname, "../demo-data/upload", EXAMPLE_UPLOAD),
  "utf8",
);
// Uploads are buffered in memory, so cap what one request can hold.
export const MAX_UPLOAD_FILES = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_UPLOAD_FILES, fileSize: MAX_FILE_BYTES },
});
// A chat message carries its attachments as base64 data URLs (4/3 of the
// bytes): room for a few files of up to 5 MB each.
const CHAT_BODY_LIMIT = "20mb";

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use("/api/chat", express.json({ limit: CHAT_BODY_LIMIT }));
app.use(express.json());
app.use(authentication);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const identity = await identify(req);
  if (!identity) {
    res.status(401).json({ error: "sign in first" });
    return;
  }
  if (identity.role === "member") {
    res.json(identity);
    return;
  }
  const trial = await trialOf(identity.userId);
  res.json({ ...identity, trial: { verified: trial !== "unverified" } });
});

// 訪客試用: a 訪客 passes the human check (a Turnstile token) to get their
// 試用工作區, made from the 示範資料 the first time; the check holds a day.
const VerifyBody = z.object({ token: z.string().min(1).max(4096) });

app.post("/api/trial/verify", async (req, res) => {
  const identity = await identify(req);
  if (!identity) {
    res.status(401).json({ error: "sign in first" });
    return;
  }
  if (identity.role !== "guest") {
    res.status(403).json({ error: "only a 訪客 has a trial workspace" });
    return;
  }
  const body = VerifyBody.safeParse(req.body);
  if (!body.success || !(await passesTurnstile(body.data.token, req.ip))) {
    res.status(403).json({ error: "人機驗證沒有通過，請再試一次。" });
    return;
  }
  await verifyGuest(identity.userId);
  res.json({ verified: true });
});

// The example file a 訪客 can upload to see a 取代 happen.
app.get("/api/trial/example", (_req, res) => {
  res.attachment(EXAMPLE_UPLOAD);
  res.type("text/plain; charset=utf-8");
  res.send(EXAMPLE_TEXT);
});

// Every knowledge base API acts for the caller in their workspace: a 成員 in
// the team workspace, a 訪客 in their own 試用工作區. 401 when nobody is
// signed in; 403 for a 訪客 who has not passed the human check today.
const requireCaller: RequestHandler = async (req, res, next) => {
  const caller = await callerOf(req);
  if (caller === "signed out") {
    res.status(401).json({ error: "sign in first" });
    return;
  }
  if (caller === "unverified") {
    res.status(403).json({
      error: "pass the human check first (POST /api/trial/verify)",
      code: "verify",
    });
    return;
  }
  res.locals.caller = caller;
  next();
};
const callerIn = (res: Response) => res.locals.caller as Caller;
app.use(
  [
    "/api/chat",
    "/api/conversations",
    "/api/proposals",
    "/api/sources",
    "/api/trial/reset",
  ],
  requireCaller,
);

// What a 訪客 is told when a request goes over the trial's limits.
const REFUSED: Record<
  Refusal | "file size",
  { status: number; error: string }
> = {
  messages: {
    status: 429,
    error: `今天的試用訊息已用完（每天 ${GUEST_LIMITS.messages} 則），明天再來試試。`,
  },
  uploads: {
    status: 429,
    error: `今天的上傳已用完（每天 ${GUEST_LIMITS.uploads} 個檔案），明天再來試試。`,
  },
  paused: {
    status: 429,
    error: "今天所有訪客的試用額度已用完，訪客試用暫停，明天再開放。",
  },
  "file size": {
    status: 413,
    error: `試用時每個檔案最大 ${GUEST_LIMITS.fileBytes / 1024 / 1024} MB。`,
  },
};

/**
 * For a 訪客, counts the request toward the trial's limits; false (and the
 * response sent) when it goes over. A 成員 has no limits.
 */
async function withinLimits(
  res: Response,
  files: { bytes: Buffer }[],
  messages: number,
): Promise<boolean> {
  const { role, userId } = callerIn(res);
  if (role !== "guest") return true;
  const refusal = files.some(
    (file) => file.bytes.length > GUEST_LIMITS.fileBytes,
  )
    ? "file size"
    : await useAllowance(userId, { messages, uploads: files.length });
  if (refusal === "ok") return true;
  const { status, error } = REFUSED[refusal];
  res.status(status).json({ error, code: refusal });
  return false;
}

// Puts the 訪客's 試用工作區 back to the 示範資料.
app.post("/api/trial/reset", async (_req, res) => {
  const { role, workspaceId } = callerIn(res);
  if (role !== "guest") {
    res
      .status(403)
      .json({ error: "only a 訪客's trial workspace can be reset" });
    return;
  }
  await resetTrial(workspaceId);
  res.json({ reset: true });
});

// Check the shapes the server reads and cap the size. Earlier answers come
// back in the history, so only questions are kept short.
const chatMessage = (role: z.ZodType<string>, maxText: number) =>
  z.looseObject({
    role,
    parts: z.array(
      z.looseObject({
        type: z.string(),
        text: z.string().max(maxText).optional(),
        filename: z.string().max(255).optional(),
        url: z.string().optional(),
      }),
    ),
  });
/** A conversation id: the chat id the web picks. */
const ConversationId = z.string().regex(/^[\w-]{1,64}$/);

const ChatRequest = z.object({
  /** Present when the conversation is to be saved (see conversations.ts). */
  id: ConversationId.optional(),
  messages: z
    .array(
      z.union([
        chatMessage(z.literal("user"), 2000),
        chatMessage(z.enum(["assistant", "system"]), 20000),
      ]),
    )
    .max(50),
});

app.post("/api/chat", async (req, res) => {
  const body = ChatRequest.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error:
        "messages must be at most 50 UI messages; a question at most 2000 characters",
    });
    return;
  }
  const { id, messages } = body.data;
  const files = attachedFiles(messages);
  if (files === "invalid" || files.length > MAX_UPLOAD_FILES) {
    res.status(400).json({
      error: `attach at most ${MAX_UPLOAD_FILES} files, each a base64 data URL`,
    });
    return;
  }
  // Someone else's conversation is answered as if it didn't exist.
  if (id && !(await mayContinue(callerIn(res), id))) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  if (!(await withinLimits(res, files, 1))) return;
  await streamReply(res, callerIn(res), messages, files, id);
});

// A 成員 sees only their own conversations; anyone else's is 404.
app.get("/api/conversations", async (_req, res) => {
  res.json(await listConversations(callerIn(res)));
});

app.get("/api/conversations/:id", async (req, res) => {
  const id = ConversationId.safeParse(req.params.id);
  const conversation =
    id.success && (await readConversation(callerIn(res), id.data));
  if (!conversation) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  res.json(conversation);
});

app.get("/api/proposals", async (_req, res) => {
  res.json(await pendingProposals(callerIn(res).workspaceId));
});

const confirmBody = z
  .object({
    edits: z
      .array(z.object({ itemId: z.string(), content: z.string().max(2000) }))
      .max(1000)
      .default([]),
    excluded: z.array(z.string()).max(1000).default([]),
    acknowledged: z.array(z.string().max(100)).max(500).default([]),
    relinks: z
      .array(z.object({ entityId: z.string(), to: z.string() }))
      .max(200)
      .default([]),
  })
  .default({ edits: [], excluded: [], acknowledged: [], relinks: [] });

// Confirming is the one way facts enter the knowledge base; no model is
// involved (ADR-0003).
app.post("/api/proposals/:id/confirm", async (req, res) => {
  const body = confirmBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: INVALID_EDIT });
    return;
  }
  const { workspaceId, userId } = callerIn(res);
  sendDecision(
    res,
    await confirmProposal(workspaceId, req.params.id, userId, body.data),
  );
});

app.post("/api/proposals/:id/reject", async (req, res) => {
  const { workspaceId, userId } = callerIn(res);
  sendDecision(res, await rejectProposal(workspaceId, req.params.id, userId));
});

const INVALID_EDIT =
  "edits and excluded must name items of this proposal, edits each with a text of 1 to 2000 characters, and at least one item must stay ticked; relinks must relink a new entity of this proposal to another live entity";

function sendDecision(
  res: express.Response,
  result: Proposal | DecisionError | Stopped,
) {
  if (typeof result === "object" && "conflicts" in result) {
    res.status(409).json({
      error:
        "the knowledge base changed since this proposal was made; confirm again acknowledging the changes, or reject it",
      conflicts: result.conflicts,
    });
  } else if (result === "not found") {
    res.status(404).json({ error: "proposal not found" });
  } else if (result === "already decided") {
    res
      .status(409)
      .json({ error: "proposal was already confirmed or rejected" });
  } else if (result === "target changed") {
    res.status(409).json({
      error:
        "a fact this proposal changes was replaced or marked obsolete since it was proposed",
    });
  } else if (result === "invalid edit") {
    res.status(400).json({ error: INVALID_EDIT });
  } else {
    res.json(result);
  }
}

// The upload entry of the 輸入 subgraph: each file becomes a 來源 and its
// facts a pending proposal, as attaching it in the chat does. Responds once
// every proposal is made; nothing enters the knowledge base until a member
// confirms one.
app.post("/api/sources", upload.array("files"), async (req, res) => {
  const files = ((req.files ?? []) as Express.Multer.File[]).map((file) => ({
    // multer decodes multipart filenames as latin1; restore UTF-8 names.
    filename: Buffer.from(file.originalname, "latin1").toString("utf8"),
    bytes: file.buffer,
  }));
  if (files.length === 0) {
    res.status(400).json({ error: "attach at least one file as `files`" });
    return;
  }
  if (!(await withinLimits(res, files, 0))) return;
  const { workspaceId, userId, role } = callerIn(res);
  const { refusal, proposals, skipped } = await inputFiles(
    workspaceId,
    userId,
    files,
    role,
  );
  if (refusal) {
    res
      .status(refusal.reason === "unsupported" ? 415 : 413)
      .json({ error: refusal.message });
    return;
  }
  res.status(201).json({ proposals, skipped });
});

const uploadLimitHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  const tooLarge = err.code === "LIMIT_FILE_SIZE";
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge
      ? "每個檔案最大 5 MB"
      : `一次最多上傳 ${MAX_UPLOAD_FILES} 個檔案`,
  });
};
app.use(uploadLimitHandler);

// Anything else that fails (e.g. Clerk unreachable) is logged here and
// answered without internals.
const internalErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "request body is too large" });
    return;
  }
  console.error("request failed:", err);
  res.status(500).json({ error: "internal error" });
};
app.use(internalErrorHandler);
