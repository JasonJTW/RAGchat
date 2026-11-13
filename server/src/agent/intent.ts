import type { Intent, State } from "./state.js";

// 判斷意圖. For now rules: a message that opens with an instruction to
// record what follows (「請把以下內容輸入到知識庫：…」「記下：…」) is input;
// a statement that something is not so, was changed, or no longer applies
// (「R 不是取代率，是回收率」「…已經過時了」) is a correction; anything else
// a question. A message ending in a question mark asks, so 「R 改成什麼了？」
// is a question; when the sentences before that question correct
// (「R 已經改成回收率了，那現在 A 怎麼算？」), it does both.

const INPUT_INSTRUCTION =
  /^\s*請?(?:幫我)?(?:把|將)?(?:以下|下面|下列)?的?(?:內容|資訊|事實)?(?:輸入|記下|記錄|記住|寫入|加入|新增|存入)(?:到|進|至)?(?:知識庫)?(?:中|裡)?\s*[:：]/;

const CORRECTION =
  /不是[^，,。？?]+[，,]\s*(?:而)?是|改成|改為|換成|改用|過時|不再(?:使用|適用|有效|採用)|已(?:經)?(?:停用|廢除|取消|作廢)|^\s*(?:更正|修正)\s*[:：]/;
// The question a message ends with, from the clause before it on: e.g.
// 「，那現在 A 怎麼算？」. What comes before is the rest of the message.
const QUESTION = /(?:^|[，,。.！!；;\n])[^，,。.！!；;\n]*[？?]\s*$/;
// Words that make a clause ask rather than state, as in 「你知道 R 改成什麼
// 了嗎」: a clause with one doesn't correct.
const ASKING = /什麼|甚麼|嗎|呢|哪|誰|如何|怎麼|怎樣|多少|幾|是否|是不是/;

/**
 * 判斷意圖: what the message asks for, and, when it corrects, the part of it
 * that does (the whole message, or what comes before its question).
 */
export function classifyIntent(
  state: Pick<State, "message">,
): Pick<State, "intents"> & Partial<Pick<State, "correction">> {
  const { message } = state;
  if (INPUT_INSTRUCTION.test(message)) return { intents: ["input"] };
  const question = QUESTION.exec(message);
  if (!question)
    return CORRECTION.test(message)
      ? { intents: ["correct"], correction: message }
      : { intents: ["ask"] };
  const rest = message.slice(0, question.index).trim();
  const intents: Intent[] = ["correct", "ask"];
  return rest && CORRECTION.test(rest) && !ASKING.test(rest)
    ? { intents, correction: rest }
    : { intents: ["ask"] };
}

/** An input message's content, without the instruction to record it. */
export function inputBody(message: string): string {
  return message.replace(INPUT_INSTRUCTION, "").trim();
}
