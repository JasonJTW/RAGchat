# 03: Markdown 切段、embedding、存檔

**What to build:** 後台上傳 `.md` 後，server 依 02 定案的切法切段，用 AI SDK 的 `embedMany` 算向量。模型透過 AI Gateway，以 `EMBEDDING_MODEL` 字串（預設 `openai/text-embedding-3-small`）指定，程式裡不 import 廠商套件。結果存進 `server/data/` 的 JSON 檔，存取都藏在單一儲存模組後面。上傳要等切段與 embedding 都完成才回應，期間按鈕顯示「處理中…」。列表顯示真實段落數。每筆文件可展開「查看段落」，列出每個 chunk 的標題路徑與前 80 字。server 重啟時把 JSON 整份載入記憶體；每個 chunk 記下產生它的 embedding 模型 id，啟動時發現 `EMBEDDING_MODEL` 換了，就自動全部重算。聊天仍是 01 的假回答。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 上傳 `fixtures/upload/05-projects-and-practice.md` 後，列表段落數等於 02 報告記的數字
- [ ] 展開 05 的「查看段落」，有一段的標題路徑是「05-projects-and-practice.md › 05 實踐案例 Projects & Practice › C. 移動微型空間計畫」，前 80 字含表頭「計畫｜期間｜站數（截至 2023）」
- [ ] 展開 03-timeline 的「查看段落」，「理念實踐期（2008–2014）」那張表若被切成多段，每段開頭都重複表頭
- [ ] 重啟 server 後重新整理 `/admin`，列表和段落數不變
- [ ] server 測試（mock embedding 模型）：把 `EMBEDDING_MODEL` 換成另一個 id 再啟動，所有 chunk 都被重新 embedding，且記錄的模型 id 是新的

## 02 定案的切法

規則見 spec「切段策略」與 [`md-chunking-report.md`](../md-chunking-report.md)。下面是 02 原型驗證過的切法（變體 e），可直接改寫成 TypeScript 放進 server。`countTokens` 由外面注入（`js-tiktoken` 的 `cl100k_base`），模組本身不做 I/O。原型全檔在分支 `prototype/02-md-chunking`。

```js
const MAX_TOKENS = 800; // per chunk, heading prefix included
const DROP_UNDER_TOKENS = 30; // e.g. a lone "_最後更新：…_" line

export function chunkMarkdown(filename, markdown, countTokens) {
  const abbreviations = parseAbbreviations(markdown); // only 03-timeline has 來源縮寫
  const chunks = [];
  for (const section of parseSections(filename, markdown)) {
    const prefix = `${section.path.join(" › ")}\n\n`;
    const budget = MAX_TOKENS - countTokens(prefix);
    for (const content of splitSection(section.blocks, budget, countTokens)) {
      if (countTokens(content) < DROP_UNDER_TOKENS) continue;
      chunks.push({
        path: section.path, // [filename, H1, H2, H3]
        content, // shown when a citation expands
        embedText: prefix + content, // embedded and BM25-indexed
        metadata: abbreviations ? { abbreviations } : {},
      });
    }
  }
  return chunks;
}

function parseSections(filename, markdown) {
  const sections = [];
  const stack = [];
  let current = { path: [filename], lines: [] };
  for (const line of markdown.split("\n")) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!m) {
      current.lines.push(line);
      continue;
    }
    sections.push(current);
    stack.length = m[1].length - 1;
    stack[m[1].length - 1] = m[2].trim();
    current = { path: [filename, ...stack.filter(Boolean)], lines: [] };
  }
  sections.push(current);
  return sections
    .map((s) => ({ path: s.path, blocks: toBlocks(s.lines) }))
    .filter((s) => s.blocks.length);
}

// Blocks: { kind: "table", header: [2 lines], rows } | { kind: "text", text }.
// Each top-level list item and each paragraph is its own text block.
function toBlocks(lines) {
  const blocks = [];
  let para = [];
  const flush = () => {
    const text = para.join("\n").trim();
    if (text && text !== "---") blocks.push({ kind: "text", text });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      flush();
      const t = [];
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

function splitSection(blocks, budget, countTokens) {
  const out = [];
  let buf = [];
  const join = (xs) => xs.join("\n\n");
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
      let rows = [];
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
      const last = buf.at(-1);
      flush();
      if (!last.startsWith("|")) buf.push(last); // overlap one paragraph / list item
    }
    buf.push(block.text);
  }
  flush();
  return out;
}

function parseAbbreviations(markdown) {
  const start = markdown.indexOf("來源縮寫：");
  if (start < 0) return null;
  const out = {};
  for (const line of markdown.slice(start).split("\n").slice(1)) {
    const m = /^- \*\*(.+?)\*\* = (.+)$/.exec(line);
    if (!m) break;
    out[m[1]] = m[2].trim();
  }
  return out;
}
```

02 用這段切 10 份 md 的段數：01=6、02=10、03=9、05=13、06=7、07=9、08=9、09=7、10=4、README=4，共 78。
