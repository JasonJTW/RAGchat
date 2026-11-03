# 03: Markdown 切段、embedding、存檔

**What to build:** 後台上傳 `.md` 後，server 依 02 定案的切法切段，用 AI SDK 的 `embedMany` 算向量。模型透過 AI Gateway，以 `EMBEDDING_MODEL` 字串（預設 `openai/text-embedding-3-small`）指定，程式裡不 import 廠商套件。結果存進 `server/data/` 的 JSON 檔，存取都藏在單一儲存模組後面。上傳要等切段與 embedding 都完成才回應，期間按鈕顯示「處理中…」。列表顯示真實段落數。每筆文件可展開「查看段落」，列出每個 chunk 的標題路徑與前 80 字。server 重啟時把 JSON 整份載入記憶體；每個 chunk 記下產生它的 embedding 模型 id，啟動時發現 `EMBEDDING_MODEL` 換了，就自動全部重算。聊天仍是 01 的假回答。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 上傳 `fixtures/upload/05-projects-and-practice.md` 後，列表段落數等於 02 報告記的數字
- [ ] 展開 05 的「查看段落」，有一段的標題路徑是「05-projects-and-practice.md › 05 實踐案例 Projects & Practice › C. 移動微型空間計畫」，前 80 字含表頭「計畫｜期間｜站數（截至 2023）」
- [ ] 展開 03-timeline 的「查看段落」，「理念實踐期（2008–2014）」那張表若被切成多段，每段開頭都重複表頭
- [ ] 重啟 server 後重新整理 `/admin`，列表和段落數不變
- [ ] server 測試（mock embedding 模型）：把 `EMBEDDING_MODEL` 換成另一個 id 再啟動，所有 chunk 都被重新 embedding，且記錄的模型 id 是新的
