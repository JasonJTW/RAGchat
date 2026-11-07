# 13: 每個第一題都判斷，省略主詞也會反問

**What to build:** 拿掉「只判斷含它／那／這／其的題目」的篩選，對話的每個第一題都先經 Jev 判斷。省略主詞、沒有代名詞的第一題（例如「是哪幾年辦的？」）也會被請使用者說明；有說出主題的一般第一題照常回答，且第一個字仍在 5 秒內出現。

**Blocked by:** 12 (done)

**Status:** done

- [x] 按「新對話」後問「是哪幾年辦的？」，畫面只顯示「請問你指的是哪個計畫或主題？」，沒有出處
- [x] answer key 的 Q1–Q12、Q6-after-delete、C1 作為第一題時都沒有被反問、各自符合 match rule，第一個字都在送出後 5 秒內出現
- [x] 完整 Demo Script 的 live E2E 全綠
- [x] server 測試（假的 Jev）：不含代名詞的第一題也會送去判斷；有上文的追問不送去判斷

## Receipt

Live run 2026-11-07: 19/19 passed, 0 flaky, 0 retries (`npm run test:live`). Full suite: unit 1 + 45, E2E 26/26.

| Acceptance criterion                                                                         | Test                                                                                    | Observed output                                                                                                                                                                                                                                                     | Screenshot                                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 新對話後問「是哪幾年辦的？」只顯示反問句、沒有出處                                           | `web/e2e/demo.live.spec.ts:421`                                                         | `one without a subject or pronoun, after 新對話, asks which subject is meant → passed`; answer: `請問你指的是哪個計畫或主題？`; 出處 count 0                                                                                                                        | `.scratch/kb-chatbot/evidence/13/1.png`            |
| answer key Q1–Q12、Q6-after-delete、C1 作為第一題都沒被反問、符合 match rule、5 秒內第一個字 | `web/e2e/demo.live.spec.ts:191`（不是反問句）、`:227`（拒答題）、`:182`／`:235`（5 秒） | 全部 passed。第一個字：Q1 2373、Q2 2876、Q4 2353、Q5 2354、Q6 2358、Q7 2369、Q8 2351、Q9 1845、Q10 2887、Q11 2354、Q12 1361、Q6-after-delete 2348 ms；C1 展開 passed。Q3 在 answer key 是 Q2 的追問（3877 ms，符合 match rule）；當第一題問時應該反問，見 ticket 12 | `.scratch/kb-chatbot/evidence/10/Q*.png`、`C1.png` |
| 完整 Demo Script 的 live E2E 全綠                                                            | `web/e2e/demo.live.spec.ts`（steps 1–8）                                                | `{'expected': 19, 'unexpected': 0, 'flaky': 0}`                                                                                                                                                                                                                     | `.scratch/kb-chatbot/evidence/10/`                 |
| server 測試：不含代名詞的第一題也送去判斷；追問不送                                          | `server/src/chat.test.ts:340`、`:352`、`:372`                                           | `✓ is checked even without a pointing word, and answered when Jev finds a name`；`✓ asks which subject is meant when one without a pointing word leaves it unnamed`；`✓ is not checked as a follow-up`                                                              | n/a                                                |
