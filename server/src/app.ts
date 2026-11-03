import express from "express";
import cors from "cors";
import multer from "multer";
import { streamAnswer } from "./chat.js";
import { addDocument, listDocuments } from "./documents.js";

export const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (_req, res) => {
  await streamAnswer(res);
});

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
