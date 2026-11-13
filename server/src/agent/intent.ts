import type { Intent, State } from "./state.js";

// 判斷意圖. For now rules: a message that opens with an instruction to
// record what follows (「請把以下內容輸入到知識庫：…」「記下：…」) is input;
// a statement that something is not so, was changed, or no longer applies
// (「R 不是取代率，是回收率」「…已經過時了」) is a correction; anything else
// a question. A message ending in a question mark is a question, so
// 「R 改成什麼了？」 is asked, not corrected (a message that both corrects
// and asks is #28's).

const INPUT_INSTRUCTION =
  /^\s*請?(?:幫我)?(?:把|將)?(?:以下|下面|下列)?的?(?:內容|資訊|事實)?(?:輸入|記下|記錄|記住|寫入|加入|新增|存入)(?:到|進|至)?(?:知識庫)?(?:中|裡)?\s*[:：]/;

const CORRECTION =
  /不是[^，,。？?]+[，,]\s*(?:而)?是|改成|改為|換成|改用|過時|不再(?:使用|適用|有效|採用)|已(?:經)?(?:停用|廢除|取消|作廢)|^\s*(?:更正|修正)\s*[:：]/;
const QUESTION = /[？?]\s*$/;

/** 判斷意圖: what the message asks for. */
export function classifyIntent(
  state: Pick<State, "message">,
): Pick<State, "intents"> {
  const { message } = state;
  const intents: Intent[] = INPUT_INSTRUCTION.test(message)
    ? ["input"]
    : CORRECTION.test(message) && !QUESTION.test(message)
      ? ["correct"]
      : ["ask"];
  return { intents };
}

/** An input message's content, without the instruction to record it. */
export function inputBody(message: string): string {
  return message.replace(INPUT_INSTRUCTION, "").trim();
}
