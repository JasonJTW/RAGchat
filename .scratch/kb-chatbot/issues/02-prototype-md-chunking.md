# 02: 原型：驗證 markdown 切法能不能找到正確段落

**What to build:** 用 `/prototype` 的 Logic 分支回答一個問題：spec 的 markdown 切段策略（標題階層切、標題路徑前綴、表格不切斷、長表按列切並重複表頭、03-timeline 來源縮寫附到 metadata）放在 wiki 上，能不能讓 answer key Q2–Q5、Q9、Q11 的正確段落出現在混合檢索的前 6 段。原型直接讀 `fixtures/upload/` 的 10 份 md，印出每份檔的 chunk 列表（標題路徑、字數、前 80 字），並比較至少三種變體：(a) spec 的做法、(b) 不加標題路徑、(c) 表格整張不按列切。每題記下正確段落在每種變體排第幾名。原型是丟棄式程式，不進 app；結論寫成報告放在 feature 資料夾，任何和 spec 不同的決定寫回 spec 的 Assumptions。

**Blocked by:** 01

**Status:** done

- [x] 報告列出 10 份 md 各自的 chunk 數，以及每個 chunk 的標題路徑與字數
- [x] 報告有一張表：Q2–Q5、Q9、Q11 × 三種變體，記正確段落在混合檢索的名次
- [x] 報告寫明選了哪種切法、理由，以及每個 chunk 的字數上下限；spec 的「切段策略」已依結論更新

## 結論

選 (e)：標題路徑前綴、每段 ≤ 800 tokens（cl100k，含前綴）、長表按整列切並重複表頭、不合併短小節、丟掉內文 < 30 tokens 的段。六題在 (a)(b)(c)(d)(e) 都進前 6；(b) 不加標題路徑讓 Q9 從第 1 掉到第 4，spec 原本的短節合併會讓出處標題路徑錯位。報告：[`md-chunking-report.md`](../md-chunking-report.md)。原型（`chunker.mjs`、`run.mjs`、可雙擊的 `prototype.html`）在分支 `prototype/02-md-chunking` 的 `.scratch/kb-chatbot/prototype-md-chunking/`。
