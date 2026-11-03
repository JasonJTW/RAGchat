# 07: PDF 與 txt／FAQ 上傳

**What to build:** 後台也收 `.pdf` 和 `.txt`。PDF 用文字層逐頁抽字，以頁為單位切段（太長再依段落切），chunk 記頁碼，出處顯示「檔名 › 第 N 頁」；沒有文字層的 PDF 段落數為 0，列表標示「無法抽出文字」。txt 偵測到 `Q:`／`Q：` 開頭的，就一組 Q/A 一段（容忍沒空行和全形冒號）；其他 txt 依空行切，沒空行的長段落依句號切成約 300 字一塊、重疊一句；出處顯示「檔名 › 段落開頭」。「查看段落」對 PDF 顯示頁碼、對 txt 顯示段落開頭。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 上傳 `04-founder-hsiao-yu-chih.pdf` 後問 Q7、Q8，回答符合 answer key，出處分別是「04-founder-hsiao-yu-chih.pdf › 第 2 頁」「… › 第 4 頁」
- [ ] 上傳 `faq.txt`，「查看段落」剛好 6 段，每段一組 Q/A（含 Q4/Q5 沒空行和「Q：」那兩組）
- [ ] 上傳 `faq.txt`、`pickup-notice.txt` 後問 Q1、Q6、Q10，回答與出處符合 answer key
- [ ] 上傳一份只有圖片的 PDF，列表段落數 0，並顯示「無法抽出文字」
