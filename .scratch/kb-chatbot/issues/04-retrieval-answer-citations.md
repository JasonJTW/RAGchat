# 04: 混合檢索、LLM 串流回答、出處

**What to build:** 前台問題送到 server 後，用 embedding cosine top 20 加上 BM25（中文字元 bigram）top 20，以 RRF 合併取前 6 段。再用 AI SDK `streamText` 以 `CHAT_MODEL`（預設 `openai/gpt-5-mini`，經 AI Gateway）串流回答，回答一律繁中，只依段落作答，用 `[1]`、`[2]` 標引用。server 把被引用的段落當出處，用 data part 跟著同一條串流送出。前台用 `@ai-sdk/react` 的 `useChat` 顯示：md 出處是「檔名 › 章節標題路徑」，點一下展開該段原文。來源互相矛盾時，回答給最新且有日期的說法，並列出其他說法。取代 01 的假回答與假出處。

**Blocked by:** 03

**Status:** done

- [x] 上傳 10 份 md 後，answer key 的 Q2、Q4、Q5、Q9、Q11 各在新對話中問一次，回答與出處都符合 match rule
- [x] 點 Q4 回答下方指到「C. 移動微型空間計畫」的出處，展開的原文符合 answer key 的 C1
- [x] 送出後 5 秒內畫面出現第一個字，之後逐字增加
- [x] server 測試（mock 模型）：LLM 回答含 `[2]` 時，串流裡的出處只有第 2 段，沒被引用的段落不列
