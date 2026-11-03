# 05: 文件裡沒有就拒答

**What to build:** 混合檢索的最高分低於門檻時，server 不呼叫 LLM，直接回固定拒答句「這個問題我無法回答」加上設定檔裡的客服信箱 `support@megaweaving.example`，不送出處。分數過了門檻、但 LLM 判斷段落裡沒有答案時，也輸出同一句、不列出處。門檻用 answer key 校準：Q1–Q11 都不能被誤拒，Q12 一定要拒答，校準的數字和方法寫回 spec。

**Blocked by:** 04

**Status:** done

- [x] 上傳 10 份 md 後問 Q12，回答含「這個問題我無法回答」與 `support@megaweaving.example`，沒有出處
- [x] 同一批文件下，Q2、Q4、Q5、Q9、Q11 都沒有被拒答
- [x] server 測試（mock 模型）：最高分低於門檻時回拒答句，而且 mock LLM 一次都沒被呼叫
