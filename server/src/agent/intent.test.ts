import { describe, expect, it } from "vitest";
import { classifyIntent, inputBody } from "./intent.js";

describe("classifyIntent", () => {
  it.each([
    "請把以下內容輸入到知識庫：我們目前的避免排放算法模型是 A = m × EF × R × L",
    "請將以下資訊記錄到知識庫: R 是取代率",
    "記下：週會改到週四",
    "幫我把下面的內容新增進知識庫：L 是壽命比",
  ])("takes %j as input", (message) => {
    expect(classifyIntent({ message })).toEqual({ intents: ["input"] });
  });

  it.each([
    "避免排放怎麼算？",
    "知識庫裡的 R 是什麼？",
    "我們要怎麼把資料輸入到知識庫？",
  ])("takes %j as a question", (message) => {
    expect(classifyIntent({ message })).toEqual({ intents: ["ask"] });
  });
});

describe("inputBody", () => {
  it("drops the instruction, keeping the content", () => {
    expect(
      inputBody("請把以下內容輸入到知識庫：\nR 是取代率。L 是壽命比"),
    ).toBe("R 是取代率。L 是壽命比");
  });
});
