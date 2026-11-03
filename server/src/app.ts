import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import multer from "multer";
import { login, requireAdmin } from "./auth.js";
import { streamAnswer } from "./chat.js";
import { addDocument, listDocuments } from "./documents.js";

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

app.post("/api/documents", upload.array("files"), (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  // multer decodes multipart filenames as latin1; restore UTF-8 names.
  const added = files.map((file) =>
    addDocument(Buffer.from(file.originalname, "latin1").toString("utf8")),
  );
  res.status(201).json(added);
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
