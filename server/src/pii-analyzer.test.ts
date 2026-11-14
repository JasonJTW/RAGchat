import { describe, expect, it } from "vitest";
import {
  localAnalyzer,
  presidioAnalyzer,
  type PiiAnalyzer,
} from "./pii-analyzer.js";

// The same cases run on the local analyzer (the fake every other test uses)
// and, when PRESIDIO_URL names a running sidecar (`npm run presidio:up`,
// then `PRESIDIO_URL=http://localhost:5002 npm test -w server`), on the real
// Presidio Analyzer with the same recognizers. CI runs only the local one.
const analyzers: [string, PiiAnalyzer][] = [["local", localAnalyzer()]];
if (process.env.PRESIDIO_URL)
  analyzers.push(["presidio", presidioAnalyzer(process.env.PRESIDIO_URL)]);

const found = async (analyzer: PiiAnalyzer, text: string) =>
  (await analyzer.analyze(text)).map((span) => ({
    kind: span.kind,
    text: text.slice(span.start, span.end),
  }));

describe.each(analyzers)("%s analyzer", (_name, analyzer) => {
  it.each([
    ["手機 0912-345-678 找我", "電話", "0912-345-678"],
    ["手機0912345678", "電話", "0912345678"],
    ["國際 +886 912 345 678", "電話", "+886 912 345 678"],
    ["市話 (02)2345-6789 分機", "電話", "(02)2345-6789"],
    ["市話 02-2345-6789", "電話", "02-2345-6789"],
    ["身分證 A123456789。", "身分證", "A123456789"],
    ["統編：12345678，", "統編", "12345678"],
    ["統一編號 87654321", "統編", "87654321"],
    [
      "寄到台北市大安區復興南路一段100號3樓給我",
      "地址",
      "台北市大安區復興南路一段100號3樓",
    ],
    ["預算 NT$30,000 左右", "金額", "NT$30,000"],
    ["花了 3 萬元", "金額", "3 萬元"],
    ["共 4500元。", "金額", "4500元"],
    ["王小明先生出席", "人名", "王小明"],
    ["請林經理回覆", "人名", "林"],
    ["寄信到 jason@example.com 吧", "信箱", "jason@example.com"],
    ["我們跟大同股份有限公司簽約", "組織", "大同股份有限公司"],
  ])("finds %s", async (text, kind, value) => {
    expect(await found(analyzer, text)).toContainEqual({ kind, text: value });
  });

  it.each([
    "避免排放 = 基線排放 - 專案排放，R 是回收率。",
    "會議在 2026-05-14 舉行，共 12 人參加。",
    "版本 1.2.3 修正了 #123。",
  ])("finds nothing in %s", async (text) => {
    expect(await found(analyzer, text)).toEqual([]);
  });

  it("gives offsets in JavaScript string units past an emoji", async () => {
    const text = "🎉🎉 電話 0912-345-678";
    expect(await found(analyzer, text)).toContainEqual({
      kind: "電話",
      text: "0912-345-678",
    });
  });
});

describe.runIf(process.env.PRESIDIO_URL)("presidio analyzer only", () => {
  it("finds English names with its NER model", async () => {
    const analyzer = presidioAnalyzer(process.env.PRESIDIO_URL!);
    expect(
      await found(analyzer, "會議由 Jason Chang 主持，結論如下。"),
    ).toContainEqual({ kind: "人名", text: "Jason Chang" });
  });

  it("ignores what its English model calls a name in Chinese text", async () => {
    const analyzer = presidioAnalyzer(process.env.PRESIDIO_URL!);
    const spans = await found(analyzer, "減碳計算模型用壽命比估算避免排放。");
    expect(spans).toEqual([]);
  });
});

describe("an unreachable analyzer", () => {
  it("fails rather than finding nothing", async () => {
    const analyzer = presidioAnalyzer("http://127.0.0.1:9");
    await expect(analyzer.analyze("王小明先生")).rejects.toThrow();
  });
});
