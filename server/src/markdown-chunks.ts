// Markdown chunking settled by the 02 prototype (variant e); see
// .scratch/kb-chatbot/md-chunking-report.md. Pure: token counting is injected.

const MAX_TOKENS = 800; // per chunk, heading prefix included
const DROP_UNDER_TOKENS = 30; // e.g. a lone "_最後更新：…_" line

export interface Chunk {
  /** [filename, H1, H2, H3]; a PDF's is [filename, "第 N 頁"], a txt's [filename, its opening] */
  path: string[];
  /** Shown when a citation expands. */
  content: string;
  /** Embedded and BM25-indexed: the heading path, then the content. */
  embedText: string;
  metadata: { abbreviations?: Record<string, string> };
}

type Block =
  | { kind: "table"; header: string[]; rows: string[] }
  | { kind: "text"; text: string };

export function chunkMarkdown(
  filename: string,
  markdown: string,
  countTokens: (text: string) => number,
): Chunk[] {
  const abbreviations = parseAbbreviations(markdown); // only 03-timeline has 來源縮寫
  const chunks: Chunk[] = [];
  for (const section of parseSections(filename, markdown)) {
    const prefix = `${section.path.join(" › ")}\n\n`;
    const budget = MAX_TOKENS - countTokens(prefix);
    for (const content of splitSection(section.blocks, budget, countTokens)) {
      if (countTokens(content) < DROP_UNDER_TOKENS) continue;
      chunks.push({
        path: section.path,
        content,
        embedText: prefix + content,
        metadata: abbreviations ? { abbreviations } : {},
      });
    }
  }
  return chunks;
}

function parseSections(filename: string, markdown: string) {
  const sections: { path: string[]; lines: string[] }[] = [];
  const stack: string[] = [];
  let current = { path: [filename], lines: [] as string[] };
  for (const line of markdown.split("\n")) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!m) {
      current.lines.push(line);
      continue;
    }
    sections.push(current);
    const level = m[1].length;
    stack.length = level - 1;
    stack[level - 1] = m[2].trim();
    current = { path: [filename, ...stack.filter(Boolean)], lines: [] };
  }
  sections.push(current);
  return sections
    .map((s) => ({ path: s.path, blocks: toBlocks(s.lines) }))
    .filter((s) => s.blocks.length);
}

// Each top-level list item and each paragraph is its own text block.
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    const text = para.join("\n").trim();
    if (text && text !== "---") blocks.push({ kind: "text", text });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      flush();
      const t: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) t.push(lines[i++]);
      i--;
      blocks.push({ kind: "table", header: t.slice(0, 2), rows: t.slice(2) });
    } else if (line.trim() === "") flush();
    else if (/^[-*] |^\d+\. /.test(line) && para.length) {
      flush();
      para.push(line);
    } else para.push(line);
  }
  flush();
  return blocks;
}

function splitSection(
  blocks: Block[],
  budget: number,
  countTokens: (text: string) => number,
): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  const join = (xs: string[]) => xs.join("\n\n");
  const flush = () => {
    if (buf.length) out.push(join(buf));
    buf = [];
  };
  for (const block of blocks) {
    if (block.kind === "table") {
      const whole = [...block.header, ...block.rows].join("\n");
      if (countTokens(whole) <= budget) {
        if (buf.length && countTokens(join([...buf, whole])) > budget) flush();
        buf.push(whole);
        continue;
      }
      flush(); // long table: packed by whole rows, header repeated
      let rows: string[] = [];
      for (const row of block.rows) {
        if (
          rows.length &&
          countTokens([...block.header, ...rows, row].join("\n")) > budget
        ) {
          out.push([...block.header, ...rows].join("\n"));
          rows = [];
        }
        rows.push(row);
      }
      if (rows.length) out.push([...block.header, ...rows].join("\n"));
      continue;
    }
    if (buf.length && countTokens(join([...buf, block.text])) > budget) {
      const last = buf[buf.length - 1];
      flush();
      if (!last.startsWith("|")) buf.push(last); // overlap one paragraph / list item
    }
    buf.push(block.text);
  }
  flush();
  return out;
}

function parseAbbreviations(markdown: string): Record<string, string> | null {
  const start = markdown.indexOf("來源縮寫：");
  if (start < 0) return null;
  const out: Record<string, string> = {};
  for (const line of markdown.slice(start).split("\n").slice(1)) {
    const m = /^- \*\*(.+?)\*\* = (.+)$/.exec(line);
    if (!m) break;
    out[m[1]] = m[2].trim();
  }
  return out;
}
