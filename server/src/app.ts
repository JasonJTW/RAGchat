import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Response,
} from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { authentication, identify } from "./auth.js";
import { streamReply } from "./chat.js";
import {
  listConversations,
  mayContinue,
  readConversation,
} from "./conversations.js";
import { isSupported } from "./document-chunks.js";
import {
  addDocuments,
  listChunks,
  listDocuments,
  removeDocument,
} from "./documents.js";
import {
  confirmProposal,
  type DecisionError,
  type Proposal,
  rejectProposal,
} from "./knowledge-base.js";
import { callerOf, type Caller } from "./workspaces.js";

export const app = express();
// Uploads are buffered in memory, so cap what one request can hold.
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_UPLOAD_FILES, fileSize: MAX_UPLOAD_FILE_BYTES },
});

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
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
  res.json(identity);
});

// Every knowledge base API acts for a 成員 in the team workspace: 401 when
// nobody is signed in, 403 for a 訪客 (their trial workspace comes in #38).
const requireMember: RequestHandler = async (req, res, next) => {
  const caller = await callerOf(req);
  if (caller === "signed out") {
    res.status(401).json({ error: "sign in first" });
    return;
  }
  if (caller === "guest") {
    res.status(403).json({ error: "guest trials are not open yet" });
    return;
  }
  res.locals.caller = caller;
  next();
};
const callerIn = (res: Response) => res.locals.caller as Caller;
app.use(
  ["/api/chat", "/api/conversations", "/api/proposals", "/api/documents"],
  requireMember,
);

// Check the shapes the server reads and cap the size. Earlier answers come
// back in the history, so only questions are kept short.
const chatMessage = (role: z.ZodType<string>, maxText: number) =>
  z.looseObject({
    role,
    parts: z.array(
      z.looseObject({
        type: z.string(),
        text: z.string().max(maxText).optional(),
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
  // Someone else's conversation is answered as if it didn't exist.
  if (id && !(await mayContinue(callerIn(res), id))) {
    res.status(404).json({ error: "conversation not found" });
    return;
  }
  await streamReply(res, callerIn(res), messages, id);
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

const confirmBody = z
  .object({
    edits: z
      .array(z.object({ itemId: z.string(), content: z.string().max(2000) }))
      .max(100)
      .default([]),
  })
  .default({ edits: [] });

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
    await confirmProposal(workspaceId, req.params.id, userId, body.data.edits),
  );
});

app.post("/api/proposals/:id/reject", async (req, res) => {
  const { workspaceId, userId } = callerIn(res);
  sendDecision(res, await rejectProposal(workspaceId, req.params.id, userId));
});

const INVALID_EDIT =
  "edits must name items of this proposal, each with a text of 1 to 2000 characters";

function sendDecision(res: express.Response, result: Proposal | DecisionError) {
  if (result === "not found") {
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

app.get("/api/documents", (_req, res) => {
  res.json(listDocuments());
});

app.get("/api/documents/:id/chunks", (req, res) => {
  const chunks = listChunks(req.params.id);
  if (!chunks) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  res.json(chunks);
});

// Responds once the removal is saved; the chatbot stops citing it at once.
app.delete("/api/documents/:id", (req, res) => {
  if (!removeDocument(req.params.id)) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  res.status(204).end();
});

// Responds only once every file is chunked, embedded, and saved. A failure
// stores none of the files, so a retry can't duplicate them.
app.post("/api/documents", upload.array("files"), async (req, res) => {
  const files = ((req.files ?? []) as Express.Multer.File[]).map((file) => ({
    // multer decodes multipart filenames as latin1; restore UTF-8 names.
    filename: Buffer.from(file.originalname, "latin1").toString("utf8"),
    bytes: file.buffer,
  }));
  const unsupported = files.filter((file) => !isSupported(file.filename));
  if (unsupported.length) {
    res.status(415).json({
      error: `Unsupported format (only .md, .pdf, .txt): ${unsupported.map((f) => f.filename).join(", ")}`,
    });
    return;
  }
  try {
    res.status(201).json(await addDocuments(files));
  } catch (error) {
    console.error("upload failed:", error);
    res.status(500).json({ error: "Upload failed; no files were added" });
  }
});

const uploadLimitHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  const tooLarge = err.code === "LIMIT_FILE_SIZE";
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge
      ? `Each file must be at most ${MAX_UPLOAD_FILE_BYTES} bytes`
      : `Upload at most ${MAX_UPLOAD_FILES} files`,
  });
};
app.use(uploadLimitHandler);

// Anything else that fails (e.g. Clerk unreachable) is logged here and
// answered without internals.
const internalErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  console.error("request failed:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal error" });
};
app.use(internalErrorHandler);
