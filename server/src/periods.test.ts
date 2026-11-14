import { describe, expect, it } from "vitest";
import { periodAsked } from "./periods.js";

// A Saturday in Taiwan.
const NOW = new Date("2026-11-14T10:00:00+08:00");

const taipei = (date: string) => new Date(`${date}T00:00:00+08:00`);
const period = (from: string, to: string) => ({
  from: taipei(from),
  to: taipei(to),
});

describe("periodAsked", () => {
  it.each([
    ["三月時我們的避免排放公式是什麼？", period("2026-03-01", "2026-04-01")],
    ["3 月的時候 R 是什麼？", period("2026-03-01", "2026-04-01")],
    ["十二月時誰負責？", period("2025-12-01", "2026-01-01")],
    ["12月時誰負責？", period("2025-12-01", "2026-01-01")],
    ["去年三月時的公式？", period("2025-03-01", "2025-04-01")],
    ["2026 年 5 月時的公式？", period("2026-05-01", "2026-06-01")],
    ["2026年5月14日當時決定了什麼？", period("2026-05-14", "2026-05-15")],
    ["2026-05-14 那天的公式？", period("2026-05-14", "2026-05-15")],
    ["截至 2026/5/14 的公式？", period("2026-05-14", "2026-05-15")],
    ["5 月 14 日以前的公式？", period("2026-05-14", "2026-05-15")],
    ["去年的時候公式是什麼？", period("2025-01-01", "2026-01-01")],
    ["在 2025 年怎麼算？", period("2025-01-01", "2026-01-01")],
    ["上個月時怎麼算？", period("2026-10-01", "2026-11-01")],
    ["上週時的公式是什麼？", period("2026-11-02", "2026-11-09")],
  ])("reads the period of %s", (question, expected) => {
    expect(periodAsked(question, NOW)).toEqual(expected);
  });

  it.each([
    "避免排放算法現在怎麼算？",
    "每月 5 日前要寄什麼？",
    "三個月檢查一次嗎？",
    "11 月的公式是什麼？",
    "今年的公式是什麼？",
    "下個月要做什麼？",
    "2027 年的計畫？",
    "2026-11-12 週會決議扣除運送排放 T",
    "去年三月的會議決定了什麼？",
    "5 月 14 日決定了什麼？",
  ])("asks about no past time in %s", (question) => {
    expect(periodAsked(question, NOW)).toBeUndefined();
  });

  it("reads 上個月份 as last month", () => {
    expect(periodAsked("上個月份的時候報表格式？", NOW)).toEqual(
      period("2026-10-01", "2026-11-01"),
    );
  });
});
