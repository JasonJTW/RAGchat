# 09: 文件管理：多檔上傳、拒收格式、列表、刪除

**What to build:** 後台上傳可以一次選多個檔案。`.pdf`、`.md`、`.txt` 以外的格式，或超過 10 MB 的檔案，顯示「不支援的檔案格式」（超過大小另有提示），不寫進列表。列表每筆顯示檔名、類型、段落數、上傳時間，並有刪除按鈕；刪除後，該文件和它的 chunks、向量立即從儲存移除，chatbot 之後不再引用它。

**Blocked by:** 04, 08

**Status:** ready-for-agent

- [ ] 一次選 `fixtures/upload/` 下 13 份支援檔上傳，列表 13 筆，每筆有檔名、類型、段落數、上傳時間
- [ ] 上傳 `fixtures/upload/not-supported.docx`，顯示「不支援的檔案格式」，列表仍 13 筆
- [ ] 刪除 `05-projects-and-practice.md` 後列表 12 筆；新對話問 Q4，回答的出處不含 05
- [ ] 重啟 server 後，被刪的文件沒有回來
