# 10: 完整 Demo 走一遍

**What to build:** 一支 Playwright E2E 從空資料開始，照 spec 的 Demo Script 1–8 跑完：登入、上傳 13 份檔、拒收 docx、問 Q1–Q12（Q2→Q3 在同一對話）、展開 C1 出處、刪除 `faq.txt` 和 `07-megaweaving-net-platform.md`、新對話再問 Q6。每一題都依 `fixtures/answer-key.md` 的 match rule 判定。這支測試標成 `@live`，透過 AI Gateway 打真的模型，沒有 `AI_GATEWAY_API_KEY` 就自動略過。有題目不過時，修前面票的行為，不改 answer key；answer key 本身有錯，就回頭問客戶。

**Blocked by:** 05, 06a, 06b, 07, 09

**Status:** ready-for-agent

- [ ] 有 `AI_GATEWAY_API_KEY` 時，E2E 跑完 Demo Script 1–8，answer key 的 U1–U3、Q1–Q12、Q6-after-delete、C1 全部符合
- [ ] 每一題送出後 5 秒內出現第一個字
- [ ] 沒有 `AI_GATEWAY_API_KEY` 時，這支 E2E 顯示略過，不是失敗
