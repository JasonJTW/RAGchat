import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import multer from "multer";
import { login, requireAdmin } from "./auth.js";
import { streamAnswer } from "./chat.js";
import { addDocuments, listChunks, listDocuments } from "./documents.js";

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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (_req, res) => {
  await streamAnswer(res);
});

app.post("/api/login", login);

app.use("/api/documents", requireAdmin);

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

// Responds only once every file is chunked, embedded, and saved. A failure
// stores none of the files, so a retry can't duplicate them.
app.post("/api/documents", upload.array("files"), async (req, res) => {
  const files = ((req.files ?? []) as Express.Multer.File[]).map((file) => ({
    // multer decodes multipart filenames as latin1; restore UTF-8 names.
    filename: Buffer.from(file.originalname, "latin1").toString("utf8"),
    bytes: file.buffer,
  }));
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
