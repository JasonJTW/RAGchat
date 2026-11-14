import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmProposal,
  propose as proposeFacts,
  searchChunks,
  searchFacts,
} from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { chunk, compare, extract, propose, toText } from "./input.js";

// The 輸入 subgraph's nodes, each from a state in to the keys it sets.

const MESSAGE =
  "請把以下內容輸入到知識庫：我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const FACT =
  "我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const NOTICE = readFileSync(
  path.join(
    import.meta.dirname,
    "../../../.scratch/kb-chatbot/fixtures/upload/pickup-notice.txt",
  ),
);

const file = (filename: string, bytes: Buffer | string) => ({
  filename,
  bytes: Buffer.from(bytes),
});

/** A file's draft after 轉文字 and 切 chunk. */
async function chunked(filename: string, bytes: Buffer | string) {
  const { inputs } = await toText({
    message: "",
    files: [file(filename, bytes)],
  });
  return chunk({ inputs }).inputs;
}

describe("toText", () => {
  it("takes a message without files as the one input", async () => {
    expect(await toText({ message: MESSAGE, files: [] })).toEqual({
      inputs: [
        {
          source: { kind: "message", content: MESSAGE },
          chunks: [],
          facts: [],
        },
      ],
      refusal: undefined,
    });
  });

  it("reads each file as an input of its own, the message being no input", async () => {
    const out = await toText({
      message: "這是取件須知",
      files: [file("pickup-notice.txt", NOTICE), file("b.md", "# B\n\nb")],
    });

    expect(out.inputs.map((d) => d.source)).toEqual([
      {
        kind: "file",
        filename: "pickup-notice.txt",
        content: NOTICE.toString("utf8"),
      },
      { kind: "file", filename: "b.md", content: "# B\n\nb" },
    ]);
  });

  it("refuses every file when one is of an unsupported format", async () => {
    const out = await toText({
      message: "",
      files: [file("a.txt", "a"), file("budget.xlsx", "PK")],
    });

    expect(out.inputs).toEqual([]);
    expect(out.refusal).toMatchObject({ reason: "unsupported" });
    expect(out.refusal!.message).toMatch(/^不支援的檔案格式：budget\.xlsx/);
  });

  it("refuses a file over 5 MB", async () => {
    const out = await toText({
      message: "",
      files: [file("big.txt", Buffer.alloc(5 * 1024 * 1024 + 1, "a"))],
    });

    expect(out.refusal).toMatchObject({ reason: "too large" });
  });
});

describe("chunk", () => {
  it("splits a file into its passages, leaving a message whole", async () => {
    const [notice] = await chunked("pickup-notice.txt", NOTICE);
    const message = chunk({
      inputs: [
        {
          source: { kind: "message", content: MESSAGE },
          chunks: [],
          facts: [],
        },
      ],
    }).inputs[0];

    expect(notice.chunks.map((c) => c.path)).toEqual([
      ["pickup-notice.txt", "取件與交接須知"],
    ]);
    expect(message.chunks).toEqual([]);
  });

  it("refuses an input of over 100 passages", async () => {
    const { inputs } = await toText({
      message: "",
      files: [
        file(
          "long.md",
          Array.from(
            { length: 101 },
            (_, i) => `# 第 ${i} 節\n\n${"內容".repeat(30)}`,
          ).join("\n\n"),
        ),
      ],
    });

    expect(chunk({ inputs }).refusal).toMatchObject({ reason: "too long" });
  });
});

describe("extract", () => {
  it("extracts the facts of a message, without the instruction to input them", async () => {
    const { chat } = installStubModels();
    chat.structured = () => ({ facts: [{ content: FACT }] });

    const { inputs } = await extract({
      inputs: [
        {
          source: { kind: "message", content: MESSAGE },
          chunks: [],
          facts: [],
        },
      ],
    });

    expect(inputs[0].facts).toEqual([{ content: FACT, chunk: undefined }]);
    expect(chat.structuredPrompts).toHaveLength(1);
    expect(chat.structuredPrompts[0]).toContain(FACT);
    expect(chat.structuredPrompts[0]).not.toContain("請把以下內容輸入到知識庫");
  });

  it("reads when each fact became true from the content, given today's date, and no later than now", async () => {
    const { chat } = installStubModels();
    chat.structured = () => ({
      facts: [
        { content: "R 上週改成回收率", validFrom: "2026-11-07" },
        { content: "L 預設 0.5", validFrom: null },
        { content: "T 自下週起扣除", validFrom: "2999-01-01" },
        { content: "EF 表有誤", validFrom: "not a date" },
      ],
    });
    const before = Date.now();

    const { inputs } = await extract({
      inputs: [
        {
          source: { kind: "message", content: "記下：R 上週就改成回收率了" },
          chunks: [],
          facts: [],
        },
      ],
    });

    const [dated, undated, future, malformed] = inputs[0].facts;
    expect(dated.validFrom).toBe(
      new Date("2026-11-07T00:00:00+08:00").toISOString(),
    );
    expect(undated.validFrom).toBeUndefined();
    expect(malformed.validFrom).toBeUndefined();
    expect(Date.parse(future.validFrom!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(future.validFrom!)).toBeLessThanOrEqual(Date.now());
    expect(chat.structuredPrompts[0]).toMatch(/今天：\d{4}-\d{2}-\d{2}/);
  });

  it("dates a file's undated facts by the file's own date, from its name or opening", async () => {
    const { chat } = installStubModels();
    chat.structured = (text) => ({
      facts: text.includes("公式")
        ? [
            { content: "公式為 A = W × EF × R", validFrom: null },
            { content: "R 上週改成 0.6", validFrom: "2026-02-20" },
          ]
        : [{ content: "維護人是林小樹", validFrom: null }],
    });
    const wiki = await chunked(
      "wiki.md",
      `# 避免排放算法\n\n> 最後更新 2026-03-02\n\n${"甲".repeat(40)}\n\n## 公式\n\n公式${"乙".repeat(40)}`,
    );
    const meeting = await chunked(
      "meeting-2026-05-14.txt",
      `週會\n\n${"丙".repeat(40)}`,
    );
    const faq = await chunked("faq.txt", `常見問題\n\n${"丁".repeat(40)}`);

    const out = await extract({
      message: "",
      files: [],
      inputs: [...wiki, ...meeting, ...faq],
    });

    const march2 = new Date("2026-03-02T00:00:00+08:00").toISOString();
    expect(out.inputs[0].facts.map((f) => f.validFrom)).toEqual([
      march2,
      march2,
      new Date("2026-02-20T00:00:00+08:00").toISOString(),
    ]);
    expect(out.inputs[1].facts[0].validFrom).toBe(
      new Date("2026-05-14T00:00:00+08:00").toISOString(),
    );
    expect(out.inputs[2].facts[0].validFrom).toBeUndefined();
  });

  it("drops blank facts", async () => {
    const { chat } = installStubModels();
    chat.structured = () => ({
      facts: [{ content: " " }, { content: "R 是取代率" }],
    });

    const { inputs } = await extract({
      inputs: [
        {
          source: { kind: "message", content: "記下：R 是取代率" },
          chunks: [],
          facts: [],
        },
      ],
    });

    expect(inputs[0].facts.map((f) => f.content)).toEqual(["R 是取代率"]);
  });

  it("extracts a file passage by passage, each fact knowing its passage", async () => {
    const { chat } = installStubModels();
    chat.structured = (text) => ({
      facts: [
        { content: text.includes("notes.md › A") ? "A 的事實" : "B 的事實" },
      ],
    });
    const inputs = await chunked(
      "notes.md",
      `# A\n\n${"甲".repeat(40)}\n\n# B\n\n${"乙".repeat(40)}`,
    );

    const out = await extract({ message: "", files: [], inputs });

    expect(chat.structuredPrompts).toHaveLength(2);
    expect(out.inputs[0].facts).toEqual([
      { content: "A 的事實", chunk: 0 },
      { content: "B 的事實", chunk: 1 },
    ]);
  });

  it("passes the member's note on the files along as context", async () => {
    const { chat } = installStubModels();
    const inputs = await chunked("pickup-notice.txt", NOTICE);

    await extract({
      message: "這是給新志工的取件須知",
      files: [file("pickup-notice.txt", NOTICE)],
      inputs,
    });

    expect(chat.structuredPrompts[0]).toContain("這是給新志工的取件須知");
    expect(chat.structuredPrompts[0]).toContain(
      "pickup-notice.txt › 取件與交接須知",
    );
  });

  it.each([
    ["meeting-2026-11-12.txt", "與會：林小樹。決議：R 改成 0.6", "決議"],
    [
      "2026-05-18 週報.md",
      `# 本週合併的 PR\n\n加入壽命比 L，${"程式碼調整".repeat(10)}`,
      "PR",
    ],
  ])("hints the prompt with the kind of %s", async (name, text, hint) => {
    const { chat } = installStubModels();

    await extract({ inputs: await chunked(name, text) });
    await extract({
      inputs: await chunked("notes.md", "# 筆記\n\n倉庫在三樓"),
    });

    const [hinted, unhinted] = chat.structuredPrompts;
    // The hint goes with the rules, before the content.
    expect(hinted.split(text)[0]).toContain(hint);
    expect(unhinted.split("倉庫在三樓")[0]).not.toContain(hint);
  });
});

describe("compare", () => {
  const FORMULA = "避免排放公式為 A = W × EF × R × L，L 為壽命比";
  const OWNER = "避免排放算法的負責人是林小樹";

  async function withFacts(...texts: string[]) {
    const workspaceId = await createWorkspace("guest", "test");
    const proposal = await proposeFacts(workspaceId, "user-a", {
      source: { kind: "message", content: texts.join("\n") },
      facts: texts.map((content) => ({
        content,
        validFrom: "2026-05-17T16:00:00.000Z",
      })),
    });
    await confirmProposal(workspaceId, proposal.id, "user-a");
    const ids = new Map(
      proposal.items.map((item) => [item.content!, item.factId!]),
    );
    return { workspaceId, ids };
  }

  const message = (...facts: { content: string; validFrom?: string }[]) => ({
    source: { kind: "message" as const, content: "x" },
    chunks: [],
    facts,
  });

  it("marks a fact replacing a current one as 取代, from when it holds, and leaves the rest new", async () => {
    const models = installStubModels();
    const { workspaceId, ids } = await withFacts(FORMULA, OWNER);
    const replacing = "公式改為 A = W × EF × R × L − T";

    const out = await compare({
      workspaceId,
      inputs: [
        message(
          { content: replacing, validFrom: "2026-11-11T16:00:00.000Z" },
          { content: "T 為取件運送排放" },
        ),
      ],
    });

    expect(out.inputs[0].facts).toEqual([
      {
        content: replacing,
        validFrom: "2026-11-11T16:00:00.000Z",
        replaces: {
          target: expect.objectContaining({
            id: ids.get(FORMULA),
            content: FORMULA,
          }) as unknown,
          reason: expect.any(String) as unknown,
        },
      },
      { content: "T 為取件運送排放" },
    ]);
    // The model saw the current facts by number and the new ones apart.
    expect(models.chat.structuredPrompts.at(-1)).toMatch(
      /\[\d\] 避免排放公式為[\s\S]*新事實：\n\(1\) 公式改為/,
    );
  });

  it("keeps 補充 and 新增 new, and lets a current fact be replaced only once", async () => {
    const models = installStubModels();
    const { workspaceId } = await withFacts(FORMULA);
    models.chat.structured = () => ({
      facts: [
        { fact: 1, kind: "supplement", target: 1, reason: null },
        { fact: 2, kind: "supersede", target: 1, reason: "改了" },
        { fact: 3, kind: "supersede", target: 1, reason: "又改了" },
        { fact: 4, kind: "supersede", target: 9, reason: "沒有這則" },
      ],
    });

    const out = await compare({
      workspaceId,
      inputs: [
        message(
          { content: "壽命比 L 依品類估計" },
          { content: "A = W × EF × R", validFrom: "2026-01-01T00:00:00.000Z" },
          { content: "A = W × R" },
          { content: "A = 1" },
        ),
      ],
    });

    expect(out.inputs[0].facts.map((f) => f.replaces?.reason)).toEqual([
      undefined,
      "改了",
      undefined,
      undefined,
    ]);
    // Never before the fact it replaces began to hold.
    expect(out.inputs[0].facts[1].validFrom).toBe("2026-05-17T16:00:00.000Z");
  });

  it("asks no model when the knowledge base has no facts yet", async () => {
    const models = installStubModels();
    const workspaceId = await createWorkspace("guest", "test");

    const out = await compare({
      workspaceId,
      inputs: [message({ content: "A = W × EF × R" })],
    });

    expect(out.inputs[0].facts).toEqual([{ content: "A = W × EF × R" }]);
    expect(models.chat.structuredPrompts).toEqual([]);
  });
});

describe("propose", () => {
  it("creates a pending proposal of a message's facts and shows it as a card", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const written: unknown[] = [];

    const out = await propose(
      {
        workspaceId,
        userId: "user-a",
        inputs: [
          {
            source: { kind: "message", content: MESSAGE },
            chunks: [],
            facts: [{ content: FACT }],
          },
        ],
      },
      { writer: (c: unknown) => written.push(c) },
    );

    expect(out.proposals).toEqual([
      expect.objectContaining({
        status: "pending",
        createdBy: "user-a",
        items: [expect.objectContaining({ kind: "add", content: FACT })],
      }),
    ]);
    expect(written).toContainEqual({
      type: "data-proposal",
      id: out.proposals[0].id,
      data: out.proposals[0],
    });
    // The reply says so in words as well.
    expect(written).toContainEqual(
      expect.objectContaining({ type: "text-delta" }),
    );
  });

  it("stores a file's passages, answered from only after confirmation", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const [draft] = await chunked("pickup-notice.txt", NOTICE);

    const out = await propose({
      workspaceId,
      userId: "user-a",
      inputs: [
        { ...draft, facts: [{ content: "取件前先確認物品狀況", chunk: 0 }] },
      ],
    });

    expect(out.proposals).toHaveLength(1);
    expect(await searchFacts(workspaceId, "取件", 5)).toEqual([]);
    expect(await searchChunks(workspaceId, "取件", 5)).toEqual([]);
  });

  it("proposes nothing for an input without facts, and says why", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const written: { type: string; delta?: string }[] = [];
    const [scan] = await chunked("scan.pdf", Buffer.from("not a pdf"));

    const out = await propose(
      {
        workspaceId,
        userId: "user-a",
        inputs: [
          {
            source: { kind: "message", content: "記下：" },
            chunks: [],
            facts: [],
          },
          scan,
        ],
      },
      { writer: (c) => written.push(c) },
    );

    expect(out).toEqual({
      proposals: [],
      skipped: [{ filename: "scan.pdf", reason: "無法抽出文字" }],
    });
    const text = written.map((c) => c.delta ?? "").join("\n");
    expect(text).toContain("沒有可以記下的事實");
    expect(text).toContain("scan.pdf：無法抽出文字");
  });

  it("only says why when the input was refused", async () => {
    installStubModels();
    const written: { type: string; delta?: string }[] = [];

    const out = await propose(
      {
        workspaceId: await createWorkspace("guest", "test"),
        userId: "user-a",
        inputs: [],
        refusal: { reason: "unsupported", message: "不支援的檔案格式：a.xlsx" },
      },
      { writer: (c) => written.push(c) },
    );

    expect(out.proposals).toEqual([]);
    expect(written.map((c) => c.delta ?? "").join("")).toBe(
      "不支援的檔案格式：a.xlsx",
    );
  });

  it("tells which older pending items its confirmation would expire, as making the same claim", async () => {
    installStubModels();
    const workspaceId = await createWorkspace("guest", "test");
    const older = await proposeFacts(workspaceId, "user-b", {
      source: { kind: "message", content: FACT },
      facts: [FACT, "M 代表質量，單位是公斤，由物資登記時填寫"],
    });
    const written: { type: string; delta?: string }[] = [];

    const out = await propose(
      {
        workspaceId,
        userId: "user-a",
        inputs: [
          {
            source: { kind: "message", content: MESSAGE },
            chunks: [],
            facts: [{ content: FACT }],
          },
        ],
      },
      { writer: (chunk) => written.push(chunk) },
    );

    expect(out.proposals[0].expires).toEqual([
      {
        proposalId: older.id,
        itemId: older.items[0].id,
        kind: "add",
        content: FACT,
        createdBy: "user-b",
      },
    ]);
    expect(written.map((c) => c.delta ?? "").join("")).toContain(
      "確認後會讓 1 項較早的待確認項目過期",
    );
  });
});
