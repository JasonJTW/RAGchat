import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkSource, fileText, isSupported } from "./source-files.js";

// 轉文字 and 切 chunk for uploaded files: the kb-chatbot chunking rules
// (依標題切、800 tokens), now with docx.

const UPLOADS = path.join(
  import.meta.dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);
const E2E_FIXTURES = path.join(import.meta.dirname, "../../web/e2e/fixtures");

async function chunksOf(file: string) {
  const filename = path.basename(file);
  const bytes = readFileSync(path.resolve(UPLOADS, file));
  return chunkSource(filename, await fileText(filename, bytes));
}

describe("isSupported", () => {
  it.each(["a.md", "a.txt", "a.pdf", "a.docx", "會議.TXT"])(
    "reads %s",
    (name) => expect(isSupported(name)).toBe(true),
  );

  it.each(["a.xlsx", "a.doc", "a.png", "README", "a.md.exe"])(
    "refuses %s",
    (name) => expect(isSupported(name)).toBe(false),
  );
});

describe("markdown", () => {
  it("splits by heading into the chunks of the 02 report", async () => {
    const chunks = await chunksOf("05-projects-and-practice.md");

    expect(chunks).toHaveLength(13);
    const c = chunks.filter(
      (chunk) =>
        chunk.path.join(" › ") ===
        "05-projects-and-practice.md › 05 實踐案例 Projects & Practice › C. 移動微型空間計畫",
    );
    expect(c).toHaveLength(1);
    expect(c[0].content).toContain("| 計畫 | 期間 | 站數（截至 2023） |");
  });

  it("starts every chunk of a split table with the table header", async () => {
    const period = (await chunksOf("03-timeline.md")).filter(
      (chunk) => chunk.path.at(-1) === "理念實踐期（2008–2014）",
    );

    expect(period).toHaveLength(3);
    for (const chunk of period)
      expect(chunk.content).toMatch(
        /^\| 時間 \| 事件 \| 來源 \|\n\|---\|---\|---\|/,
      );
  });

  it("keeps a file too short for a chunk as one chunk", () => {
    expect(chunkSource("short.md", "# 筆記\n\n週會在週四。")).toEqual([
      expect.objectContaining({
        path: ["short.md"],
        content: "# 筆記\n\n週會在週四。",
      }),
    ]);
  });
});

describe("txt", () => {
  it("splits a FAQ into one chunk per Q/A, messy ones included", async () => {
    const chunks = await chunksOf("faq.txt");

    expect(chunks).toHaveLength(6);
    for (const chunk of chunks) {
      expect(chunk.path.join(" › ")).toMatch(/^faq\.txt › Q[:：]/);
      expect(chunk.content).toMatch(/^Q[:：].*\nA[:：]/);
    }
    // Q4 and Q5 have no blank line between them.
    expect(
      chunks.find((c) => c.path[1] === "Q: 搜尋一定要用中文關鍵字嗎？")!
        .content,
    ).not.toContain("FB 社團原文");
  });

  it("splits a long paragraph by sentence, overlapping one", async () => {
    const chunks = await chunksOf(
      path.join(E2E_FIXTURES, "long-paragraph.txt"),
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].path[1]).toMatch(/^第一句說明/);
    expect(chunks[1].path[1]).toMatch(/^第六句說明/);
  });

  it("keeps a short paragraph as one chunk, cited by its opening", async () => {
    const chunks = await chunksOf("pickup-notice.txt");

    expect(chunks.map((c) => c.path)).toEqual([
      ["pickup-notice.txt", "取件與交接須知"],
    ]);
  });
});

describe("pdf", () => {
  it("splits by page, each chunk cited by its page, Kangxi radicals read as plain characters", async () => {
    const chunks = await chunksOf("04-founder-hsiao-yu-chih.pdf");

    for (const n of [1, 2, 3, 4])
      expect(chunks.some((c) => c.path[1] === `第 ${n} 頁`)).toBe(true);
    expect(chunks.find((c) => c.path[1] === "第 4 頁")!.content).toContain(
      "2017 旅梯計畫 台新藝術獎文件展",
    );
  });

  it("splits a page over the token limit evenly, leaving no scrap", async () => {
    const page2 = (await chunksOf("04-founder-hsiao-yu-chih.pdf")).filter(
      (c) => c.path[1] === "第 2 頁",
    );

    // Page 2 is ~820 tokens: two halves, not 796 tokens plus a 28-token tail.
    expect(page2).toHaveLength(2);
    for (const chunk of page2)
      expect(chunk.content.length).toBeGreaterThan(200);
  });

  it("reads no text from a PDF without a text layer", async () => {
    const text = await fileText(
      "image-only.pdf",
      readFileSync(path.join(E2E_FIXTURES, "image-only.pdf")),
    );

    expect(text.trim()).toBe("");
    expect(chunkSource("image-only.pdf", text)).toEqual([]);
  });
});

describe("docx", () => {
  it("reads the document's paragraphs as text, one chunk each", async () => {
    const text = await fileText(
      "warehouse-inventory.docx",
      readFileSync(path.join(E2E_FIXTURES, "warehouse-inventory.docx")),
    );

    expect(text).toContain(
      "倉庫盤點在每月最後一個週六上午十點進行，由張小石負責。",
    );
    expect(
      chunkSource("warehouse-inventory.docx", text).map((c) => c.path[1]),
    ).toEqual([
      "好物輪轉 倉庫盤點須知",
      "倉庫盤點在每月最後一個週六上午十點進行，由張小石負責。",
      "盤點後在共用試算表登記每個類別的件數。",
    ]);
  });

  it("reads no text from a file that is not really a docx", async () => {
    expect(
      await fileText(
        "not-supported.docx",
        readFileSync(path.join(UPLOADS, "not-supported.docx")),
      ),
    ).toBe("");
  });
});
