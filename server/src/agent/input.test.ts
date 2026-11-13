import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchChunks, searchFacts } from "../knowledge-base.js";
import { installStubModels } from "../stub-models.js";
import { createWorkspace } from "../workspaces.js";
import { chunk, extract, propose, toText } from "./input.js";

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
});
