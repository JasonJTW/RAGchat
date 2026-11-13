import type { Intent, State } from "./state.js";

// 判斷意圖. For now a rule: a message that attaches files, or opens with an
// instruction to record what follows (「請把以下內容輸入到知識庫：…」
// 「記下：…」), is input; anything else a question. Corrections (#26) will need a model.

const INPUT_INSTRUCTION =
  /^\s*請?(?:幫我)?(?:把|將)?(?:以下|下面|下列)?的?(?:內容|資訊|事實)?(?:輸入|記下|記錄|記住|寫入|加入|新增|存入)(?:到|進|至)?(?:知識庫)?(?:中|裡)?\s*[:：]/;

/** 判斷意圖: what the message asks for. */
export function classifyIntent(
  state: Pick<State, "message"> & Partial<Pick<State, "attachments">>,
): Pick<State, "intents"> {
  const intents: Intent[] =
    state.attachments || INPUT_INSTRUCTION.test(state.message)
      ? ["input"]
      : ["ask"];
  return { intents };
}

/** An input message's content, without the instruction to record it. */
export function inputBody(message: string): string {
  return message.replace(INPUT_INSTRUCTION, "").trim();
}
