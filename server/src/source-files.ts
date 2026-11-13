import { getEncoding } from "js-tiktoken";
import mammoth from "mammoth";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chunkMarkdown, type Chunk } from "./markdown-chunks.js";

// An uploaded file as a 來源: its text (轉文字), then its passages (切 chunk),
// by extension. A chunk's path is what its citation shows after the
// filename: the markdown heading path, the PDF page, or the opening of a txt
// or docx paragraph.

export type { Chunk } from "./markdown-chunks.js";

const MAX_TOKENS = 800; // per PDF chunk, page prefix included, as for markdown
const SENTENCES_PER_CHUNK_CHARS = 300; // txt paragraphs without blank lines
const OPENING_CHARS = 40; // a txt chunk's path

/** The formats a 來源 file may have. */
export const SUPPORTED_FORMATS = ["md", "txt", "pdf", "docx"];

// A PDF's pages are separated by a form feed, as pdftotext does.
const PAGE_BREAK = "\f";

const encoding = getEncoding("cl100k_base");
const countTokens = (text: string) => encoding.encode(text).length;

const extensionOf = (filename: string) =>
  filename.toLowerCase().split(".").pop();

/** Whether the file can be read: markdown, txt, PDF or docx. */
export function isSupported(filename: string): boolean {
  return SUPPORTED_FORMATS.includes(extensionOf(filename) ?? "");
}

/**
 * 轉文字: the file's text. A PDF's is its text layer, pages separated by a
 * form feed; a scan, a broken PDF or a broken docx has none (""). Check
 * `isSupported` first.
 */
export async function fileText(
  filename: string,
  bytes: Buffer,
): Promise<string> {
  const extension = extensionOf(filename);
  if (extension === "md" || extension === "txt")
    return bytes.toString("utf8").replace(/\r\n?/g, "\n");
  if (extension === "pdf") return (await pdfPages(bytes)).join(PAGE_BREAK);
  if (extension === "docx") {
    try {
      return (await mammoth.extractRawText({ buffer: bytes })).value;
    } catch {
      return "";
    }
  }
  throw new Error(`unsupported format: ${filename}`);
}

/**
 * 切 chunk: the passages of a file's text, as `fileText` gave it. Markdown is
 * split by heading, a PDF by page, txt and docx by Q/A pair or paragraph.
 */
export function chunkSource(filename: string, text: string): Chunk[] {
  const extension = extensionOf(filename);
  if (extension === "md") {
    const chunks = chunkMarkdown(filename, text, countTokens);
    // A file too short to keep a chunk of is one chunk.
    const content = text.trim();
    return chunks.length || !content
      ? chunks
      : [
          {
            path: [filename],
            content,
            embedText: `${filename}\n\n${content}`,
            metadata: {},
          },
        ];
  }
  if (extension === "pdf") return chunkPdf(filename, text.split(PAGE_BREAK));
  return chunkText(filename, text);
}

/**
 * One chunk per page of the PDF's text layer; a page over the token limit is
 * split by whole lines into even parts. A PDF without a text layer (a scan) has no chunks.
 */
function chunkPdf(filename: string, pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const [i, text] of pages.entries()) {
    if (!text.trim()) continue;
    const path = [filename, `第 ${i + 1} 頁`];
    const prefix = `${path.join(" › ")}\n\n`;
    // Even parts, so an over-long page leaves no few-word scrap.
    const budget = MAX_TOKENS - countTokens(prefix);
    const target = countTokens(text) / Math.ceil(countTokens(text) / budget);
    let lines: string[] = [];
    const flush = () => {
      const content = lines.join("\n").trim();
      if (content)
        chunks.push({
          path,
          content,
          embedText: prefix + content,
          metadata: {},
        });
      lines = [];
    };
    for (const line of text.split("\n")) {
      if (lines.length && countTokens([...lines, line].join("\n")) > budget)
        flush();
      lines.push(line);
      if (countTokens(lines.join("\n")) >= target) flush();
    }
    flush();
  }
  return chunks;
}

/** Each page's text, line by line; [] when the file isn't a readable PDF. */
async function pdfPages(bytes: Buffer): Promise<string[]> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: VerbosityLevel.ERRORS,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    return [];
  }
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    let text = "";
    for (const item of items)
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    // Chrome prints some CJK as Kangxi radicals (⼈ U+2F08); read them as 人.
    pages.push(text.replace(/[\u2E80-\u2FDF]/gu, (c) => c.normalize("NFKC")));
  }
  await task.destroy();
  return pages;
}

/**
 * A FAQ (any line starting `Q:` or `Q：`) is one chunk per Q/A, blank lines
 * or not; anything before the first Q is dropped. Other text is one chunk per
 * paragraph, long paragraphs split by sentence.
 */
function chunkText(filename: string, text: string): Chunk[] {
  const lines = text.split("\n");
  const isQuestion = (line: string) => /^Q[:：]/.test(line.trim());
  let pieces: string[];
  if (lines.some(isQuestion)) {
    pieces = [];
    for (const line of lines) {
      if (isQuestion(line)) pieces.push(line);
      else if (pieces.length) pieces[pieces.length - 1] += `\n${line}`;
    }
  } else
    pieces = text
      .split(/\n\s*\n/)
      .flatMap((paragraph) => splitSentences(paragraph.trim()));
  return pieces
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((content) => {
      const path = [filename, opening(content)];
      return {
        path,
        content,
        embedText: `${path.join(" › ")}\n\n${content}`,
        metadata: {},
      };
    });
}

// Packs whole sentences into chunks of about 300 characters, each chunk
// starting with the previous one's last sentence.
function splitSentences(paragraph: string): string[] {
  if (paragraph.length <= SENTENCES_PER_CHUNK_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^。！？]+[。！？]*/g) ?? [];
  const out: string[] = [];
  let buf: string[] = [];
  for (const sentence of sentences) {
    if (
      buf.length > (out.length ? 1 : 0) && // more than the overlap
      [...buf, sentence].join("").length > SENTENCES_PER_CHUNK_CHARS
    ) {
      out.push(buf.join(""));
      buf = [buf[buf.length - 1]];
    }
    buf.push(sentence);
  }
  out.push(buf.join(""));
  return out;
}

function opening(content: string): string {
  const firstLine = content.split("\n")[0].trim();
  const chars = Array.from(firstLine);
  return chars.length <= OPENING_CHARS
    ? firstLine
    : `${chars.slice(0, OPENING_CHARS).join("")}…`;
}
