# 06a: 追問與「新對話」

**What to build:** 同一個聊天視窗裡，第二題起，server 先用 `CHAT_MODEL` 的 `generateText` 把「對話紀錄＋新問題」改寫成一句獨立的問題，再拿去檢索；回答時仍帶著對話紀錄。前台有「新對話」按鈕，按下清空畫面和對話 state。聊天紀錄只存在分頁 state，重新整理就消失。

從原本的 06 拆出：這部分在 `strike/06-attempt-1` 已全綠，沒上文的代名詞問題移到 06b。

**Blocked by:** 04

**Status:** done

- [x] 上傳 10 份 md 後，先問 Q2 再接著問 Q3，Q3 的回答與出處符合 answer key
- [x] 按「新對話」後畫面沒有任何訊息
- [x] server 測試（mock 模型）：有對話紀錄時，送進檢索的是改寫後的問題，不是原句

## Strikes

- 試過：把 `strike/06-attempt-1` 的改寫、帶紀錄回答、「新對話」接到 main（含 05 拒答）上，拿掉 attempt 裡的代名詞規則。
- 觀察到：full suite 綠；live 的 Q2 第一個字一次超過 5 秒（重跑 3/3 綠），Q9 出處 4/8 次是空的，main 同題 12/12 綠。失敗那幾次模型用全形〔1〕標出處，`cited()` 只認 [1]。
- 修正：`cited()` 也認〔〕［］【】，加 server 測試；之後 Q9 live 8/8 綠，全套 live 13/13 綠。

## Receipt

| Acceptance criterion                                | Test                               | Observed output                                                                                                                                                                                                                                       | Screenshot                               |
| --------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 先問 Q2 再接著問 Q3，Q3 的回答與出處符合 answer key | `web/e2e/answers.live.spec.ts:222` | `Q3 follows up Q2 passed`；回答「它在 2008 秋–2012 春間辦理…總共累積 20 多個案例」；出處 `[1] 05-projects-and-practice.md › … › A1. 一百元的大直社區改造計畫（2008–2012）`、`[4] 03-timeline.md › … › 理念實踐期（2008–2014）`；全套 live `13 passed` | `.scratch/kb-chatbot/evidence/06a/1.png` |
| 按「新對話」後畫面沒有任何訊息                      | `web/e2e/chat.spec.ts:80`          | `新對話 clears the conversation` 通過：回答 0 則、原問題文字 0 處；E2E `26 passed`                                                                                                                                                                    | `.scratch/kb-chatbot/evidence/06a/2.png` |
| server 測試：有對話紀錄時，送進檢索的是改寫後的問題 | `server/src/chat.test.ts:265`      | `is retrieved as the standalone question the model rewrites it to` ✓：最後一次 embedding 是 `STANDALONE`，不含原句 Q3；server `36 passed`                                                                                                             | n/a                                      |
