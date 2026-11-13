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
    "R 改成什麼了？",
    "R 是不是回收率？",
  ])("takes %j as a question", (message) => {
    expect(classifyIntent({ message })).toEqual({ intents: ["ask"] });
  });
});

describe("classifyIntent on a correction", () => {
  it.each([
    "R 不是取代率，是回收率",
    "R 不是取代率,而是回收率。",
    "其實 R 已經改成回收率了",
    "週會改為週四",
    "倉庫盤點那則已經過時了",
    "舊的報名表單不再使用",
    "這個做法已經停用",
    "更正：L 是使用年限比",
  ])("takes %j as a correction", (message) => {
    expect(classifyIntent({ message })).toEqual({ intents: ["correct"] });
  });

  it("takes an input instruction as input, even if it reads like a correction", () => {
    expect(classifyIntent({ message: "記下：週會改成週四" })).toEqual({
      intents: ["input"],
    });
  });
});

describe("classifyIntent with attachments", () => {
  it("takes a message with files as input, whatever it says", () => {
    expect(
      classifyIntent({ message: "R 不是取代率，是回收率", attachments: 1 }),
    ).toEqual({
      intents: ["input"],
    });
  });
});

describe("inputBody", () => {
  it("drops the instruction, keeping the content", () => {
    expect(
      inputBody("請把以下內容輸入到知識庫：\nR 是取代率。L 是壽命比"),
    ).toBe("R 是取代率。L 是壽命比");
  });
});
