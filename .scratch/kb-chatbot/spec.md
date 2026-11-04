## Feature

身為 megaweaving 大量交織的使用者，我想要在網站的聊天視窗用中文直接問 chatbot 關於大量交織（理念、FB 社團、megaweaving.net 平台、交換規則）的問題，並看到每個回答根據哪份文件的哪一段，以便不用自己翻 wiki 就能得到正確、可核對的答案；身為管理員，我想要登入後台上傳或刪除 PDF、markdown、純文字文件，以便 chatbot 的知識跟著文件更新。

**Seam**: 瀏覽器畫面：前台聊天頁 `http://localhost:3000/`、後台 `http://localhost:3000/admin`（Playwright 可直接操作與讀取）
**Acceptance criteria**:

- [x] 未登入進 `/admin` 會被導到登入畫面；帳密錯誤顯示「帳號或密碼錯誤」，正確後看到文件列表
- [x] 後台可上傳 `.pdf`、`.md`、`.txt`，一次可選多檔（每次最多 10 份）；分兩批上傳 `fixtures/upload/` 的 13 份支援檔後，列表顯示 13 筆，每筆有檔名、類型、段落（chunk）數、上傳時間
- [x] 上傳 `.docx` 等不支援格式時，畫面顯示「不支援的檔案格式」，列表筆數不變
- [x] 後台可刪除文件；刪除後該文件立即從列表消失，chatbot 也不再引用它
- [x] 前台聊天回答以串流逐字顯示，第一個字在送出後 5 秒內出現
- [x] `fixtures/answer-key.md` 的 Q1–Q12、Q6-after-delete、C1 全部符合各自的 match rule
- [x] 每個依據文件作答的回答下方列出至少 1 個出處：markdown 顯示「檔名 › 章節標題路徑」、PDF 顯示「檔名 › 第 N 頁」、txt 顯示「檔名 › 段落開頭」；點出處會展開該段原文
- [x] 文件沒有寫到的問題，回答固定包含「這個問題我無法回答」與客服信箱 `support@megaweaving.example`，且不列出處
- [x] 同一個聊天視窗支援追問：第二題用代名詞（「那它…」）指涉上一題時仍答對
- [x] 前台有「新對話」按鈕，按下後清空對話紀錄

## Demo Script

1. 未登入開 `/admin` → 被導到登入畫面
2. 登入畫面輸入 `admin` / 錯誤密碼 → 顯示「帳號或密碼錯誤」；改輸入正確密碼（`.env` 的 `ADMIN_PASSWORD`）→ 進入後台，文件列表為空
3. 後台分兩批上傳 `fixtures/upload/` 下 13 份 `.md`、`.pdf`、`.txt`：先選 10 份 `.md` 上傳，再選其餘 3 份（`04-founder-hsiao-yu-chih.pdf`、`faq.txt`、`pickup-notice.txt`）上傳 → 列表出現 13 筆，各自顯示段落數（0 以上的整數）
4. 後台上傳 `fixtures/upload/not-supported.docx` → 顯示「不支援的檔案格式」，列表仍為 13 筆
5. 前台問 answer-key 的 Q1–Q11（Q2→Q3 為同一對話的追問）→ 每題回答符合 answer key 的 match rule，出處列在回答下方
6. 點 Q4 回答下方的出處 → 展開 `05-projects-and-practice.md` 「C. 移動微型空間計畫」那張表的原文
7. 前台問 Q12（文件沒寫的問題）→ 回答「這個問題我無法回答」＋ `support@megaweaving.example`，無出處
8. 後台刪除 `faq.txt` 和 `07-megaweaving-net-platform.md` → 列表剩 11 筆；前台按「新對話」再問 Q6（「搜尋一定要用中文關鍵字嗎？」）→ 回答「這個問題我無法回答」＋客服信箱（answer key 的 Q6-after-delete）

## Stubs

- 管理員帳號：只有一組帳密，從根目錄 `.env` 的 `ADMIN_USERNAME`（預設 `admin`）、`ADMIN_PASSWORD` 讀取；登入後發 httpOnly session cookie，存在記憶體，伺服器重啟就要重新登入
- 客服聯絡方式：固定假信箱 `support@megaweaving.example`，寫在設定檔，不是真的信箱
- 文件與向量儲存：存在 `server/data/` 的 JSON 檔（原始檔＋chunks＋embeddings），不用資料庫；server 啟動時整份載入記憶體，檢索直接逐一算 cosine。儲存與檢索藏在同一個介面後面，之後換成 pgvector 等向量資料庫只動這個模組
- 聊天紀錄：只存在瀏覽器分頁的 state，重新整理就消失

## Assumptions

- 使用者情境：前台的提問者是 megaweaving 的一般使用者／社團成員，問題涵蓋理念、發起人、社團、平台功能與交換規則
- 知識來源是 `/Users/zhangjunhao/Desktop/megaweave/wiki` 的 11 份 markdown；fixtures 裡把 `04-founder-hsiao-yu-chih.md` 改成 PDF（Chrome 列印，4 頁，「經歷」與「主要作品」表格跨頁）來代表 PDF 上傳，04 不再以 markdown 上傳，避免同一內容出現兩次
- 「FAQ」與「純文字」的範例是我依 wiki 01、06、07 頁內容合成的：`faq.txt`（6 組 Q/A，含一處 Q/A 之間沒空行、一處用全形冒號「Q：」的 messy case）與 `pickup-notice.txt`（一整段不分行的取件須知）；內容只取 wiki 寫過的事實
- FAQ 用 `.txt` 上傳，不另做 FAQ 編輯介面；後台只有上傳、列表、刪除，不能線上編輯文件內容
- 只有後台要登入；前台聊天頁不用登入，任何人打開就能問
- 登入只做一組帳密（環境變數），沒有註冊、忘記密碼、多管理員
- 回答一律用繁體中文；使用者用英文問也回繁中
- LLM 呼叫一律走 Vercel AI SDK（`ai` 套件的 `streamText`、`generateText`、`embedMany`、`embed`），透過 Vercel AI Gateway 連模型：Gateway 是 AI SDK 預設的全域 provider，模型直接寫成 `<廠商>/<模型>` 字串，程式裡不 import 任何廠商套件（不用 `@ai-sdk/openai`）（影響 Demo Script 5–8）
  - 聊天模型：`CHAT_MODEL`，預設 `openai/gpt-5-mini`；追問改寫也用同一個
  - 聊天以 `reasoningEffort: minimal` 呼叫 OpenAI 推理模型：預設強度下第一個字要約 7 秒，超過 5 秒的要求；minimal 約 2.5 秒（含問題 embedding 約 1 秒），answer key 仍全數符合
  - Embedding 模型：`EMBEDDING_MODEL`，預設 `openai/text-embedding-3-small`
  - 金鑰：只要根目錄 `.env` 的 `AI_GATEWAY_API_KEY`；換成 `anthropic/…`、`google/…` 等模型只改環境變數字串，不用裝套件、不用各家金鑰
  - 模型字串只在 server 啟動時從環境變數讀一次，集中在一個模組；聊天、改寫、embedding 都從那裡拿
  - 每個 chunk 記下產生它的 embedding 模型 id；server 啟動時如果發現 `EMBEDDING_MODEL` 換了，就自動把所有文件重新 embedding（不同模型的向量維度不同，不能混著比）
- 第一題要不要先反問（影響 Demo Script 5、8；取代 06b 用 `CHAT_MODEL` 判斷的做法）：
  - 「問題有沒有說出要問的對象的名稱」改由 Jev（TypeSafe System One）判斷，一律透過官方 JavaScript SDK `@typesafe-ai/sdk` 呼叫，不直接打 HTTP API，是 LLM 呼叫一律走 AI SDK 的唯一例外；金鑰是根目錄 `.env` 的 `JEV_API_KEY`
  - 判斷跑完才開始檢索與回答，不再同時開跑、暫存回答
  - 對話的每個第一題都判斷，不再只判斷含「它／那／這／其」的題目，所以省略主詞的第一題（例如「是哪幾年辦的？」）也會被反問
  - Jev 回傳「沒說出名稱」的機率（Noul），≥ 0.5 才反問。11 原型校準：該照常回答的題目最高 0.28、該反問的最低 0.69；Jev 熱呼叫中位 215 ms、冷呼叫 313–436 ms
  - 已知缺口：「每個人最多可以花多少錢？」這類省略主詞、但看起來像一般問題的第一題，Jev 只給 0.39–0.41，會照常回答不反問
  - Jev 失敗、逾時（上限約 1.5 秒）或沒設 `JEV_API_KEY` 時照常回答，不反問
  - 有上文的追問照舊不判斷，改寫成獨立問題仍用 `CHAT_MODEL`
  - 單元與 server 測試用假的 Jev，不打網路；`@live` 測試要 `JEV_API_KEY`
- 切段策略（影響 Demo Script 3、5、6；markdown 部分經 02 原型驗證，見 `md-chunking-report.md`）：
  - markdown 依標題階層（`#`/`##`/`###`）切，每段前面加上「檔名 › H1 › H2 › H3」的標題路徑一起 embedding，也一起進 BM25。原型實測拿掉標題路徑後 Q9 的正確段落從第 1 掉到第 4
  - 每段上限 800 tokens，用 `cl100k_base`（`js-tiktoken`）計，標題路徑前綴也算在內；原型實測 10 份 md 切成 78 段，每段 73–800 tokens（47–1,527 字）
  - 表格不從中間切斷；表格超過上限時按整列打包切，每塊都重複表頭（表頭兩行）與所屬標題路徑；一列就是一筆事實（年表、經歷、站數表）。表格前後的文字跟表格放同一段，放不下才分開
  - 同一小節超過上限時依段落／清單項目再切，前後重疊一個段落或清單項目（表格不重疊）
  - 不合併短小節：原型發現「短節併到同層下一節」會把 D 節的文字併進 E 節的 chunk，出處標題路徑跟著錯；短節帶著標題路徑本來就找得到。改成丟掉內文少於 30 tokens 的段（實際只會丟掉檔頭只有「_最後更新：…_」的那一行）
  - 03-timeline 開頭的「來源縮寫」表（BIO、SCU-FAC…）附到該檔每個 chunk 的 metadata，回答時能把縮寫還原
  - PDF 用文字層逐頁抽字（`pdfjs-dist`），以頁為單位切，太長再依整行均分（避免留下幾個字的尾巴：04 PDF 第 2 頁原本切成 796＋28 tokens，改成 413＋411 後 Q7 從 2/4 變 4/4）；chunk 記頁碼，用來顯示「第 N 頁」；跨頁的表格當兩個 chunk，不嘗試合併。Chrome 列印的 PDF 文字層把部分漢字存成康熙部首（`⼈` U+2F08），抽字時轉回一般漢字
  - txt：偵測到 `Q:`／`Q：` 開頭的就一組 Q/A 一個 chunk（容忍沒空行和全形冒號）；其他 txt 依空行切，沒空行的長段落依句號切成約 300 字一塊、重疊一句
- 檢索方法（影響 Demo Script 5、7、8）：混合檢索 = embedding cosine top 20 ＋ 關鍵字 BM25（中文用字元 bigram 斷詞）top 20，用 RRF 合併後取前 6 段送進 LLM；追問時先用 LLM 把問題改寫成獨立問題再檢索
- 拒答規則（影響 Demo Script 7、8）：system prompt 要求只依提供的段落作答、段落沒有就輸出固定拒答句「這個問題我無法回答，請來信客服 support@megaweaving.example。」；回答含「這個問題我無法回答」時不送出處。此外若混合檢索最高分低於門檻，直接拒答、不呼叫 LLM
  - 「最高分」用問題與所有 chunk 的最高 embedding cosine：RRF 分數只反映名次，不管問題多無關，第 1 名的分數都一樣，不能當門檻
  - 門檻 0.30（只對 `openai/text-embedding-3-small` 有效，換 `EMBEDDING_MODEL` 要重新校準）。校準方法：上傳 10 份 md ＋ `source/04-founder-hsiao-yu-chih.md`（代替還不能上傳的 PDF），用真的 embedding 算 answer key 每題的最高 cosine：可答題 Q1–Q11 落在 0.38（Q6）到 0.73（Q5）之間，Q12 是 0.22；取兩者中點 0.30，兩邊各留約 0.08
  - 門檻只擋明顯無關的問題；分數過門檻但文件沒寫的（Q6-after-delete 0.38、「平台有手機 App 嗎」0.41、「推薦拉麵店」0.32）靠 LLM 拒答，實測三題都輸出拒答句、沒有出處
  - 07 上傳 PDF、txt 後重算（13 份全上傳）：Q1 0.85、Q6 0.74、Q7 0.41、Q8 0.60、Q10 0.63，都在 0.30 以上；但 Q12 從 0.22 升到 0.27，離門檻只剩 0.03，再加文件時要重測
- 來源互相矛盾時（例如社團人數 8,000+／11k／12,000+），回答給最新且有日期的數字，並說明其他說法與「未經 Group Insights 確認」
- 出處由後端回傳實際送進 LLM 的段落中、被回答引用到的那幾段（LLM 以 `[1]`、`[2]` 標記），不是讓 LLM 自己寫檔名
- 單一使用者在本機跑：`npm run dev` 起 web :3000 與 server :4000，不部署
- 掃描版（只有圖片、沒有文字層）的 PDF 不支援；上傳後段落數為 0 並在列表標示「無法抽出文字」
- 資料量規模：demo 文件約 4.3 萬字、預估 150–250 個 chunk，暴力 cosine 每次查詢不到 1 ms，JSON 檔約 5 MB。先卡住的是 JSON 檔大小（每個 1536 維向量存成文字約 30 KB），不是計算：約 2,000 個 chunk（約 60 萬字、60 MB）以內都沒問題；超過這個量、或需要多台 server 同時讀寫時，再換向量資料庫
- 前後台連線（影響 Demo Script 1–2）：瀏覽器只連 :3000，Next.js 用 rewrites 把 `/api/*` 轉給 Express :4000，所以登入 cookie 是同源的，不用處理跨域 cookie
- 聊天串流（影響 Demo Script 5–7）：前台用 `@ai-sdk/react` 的 `useChat`，後端回 AI SDK 的 UI message stream；出處以 data part 跟著同一個串流送到前台，不另開請求
- 上傳是同步處理（影響 Demo Script 3）：上傳請求等切段與 embedding 都完成才回應，回應後那筆才出現在列表；每批（最多 10 份）預估幾十秒內完成，上傳期間按鈕顯示「處理中…」
- 測試分兩層（影響全部 Acceptance criteria）：單元與 server 測試用 AI SDK 的 mock 模型，不打 AI Gateway，CI 照常跑；answer key 的 Playwright E2E 會透過 AI Gateway 打真的模型，標成 `@live`、用 `npm run test:live` 跑，沒有 `AI_GATEWAY_API_KEY` 時自動略過，在本機手動跑
- 後台段落檢視（影響 Demo Script 3）：列表每筆文件可以展開「查看段落」，列出每個 chunk 的標題路徑（PDF 為頁碼）與前 80 字，用來檢查切法；唯讀，不能編輯
- 上傳上限：每次最多 10 份、單檔最多 5 MB（server 已實作：超過份數回 400、超過大小回 413）。只在記憶體暫存上傳內容，所以設上限；demo 最大的檔案是 0.5 MB 的 PDF
- answer-key 的期望答案是我直接讀 wiki 原文寫的，客戶確認前都算假設

## Out of Scope

- 掃描 PDF 的 OCR、Word／Excel／網頁等其他格式
- 多管理員、權限分級、註冊、忘記密碼、前台使用者登入
- 聊天紀錄保存、對話分析、滿意度回饋（👍／👎）
- 真人客服轉接（只給信箱，不建工單、不接 LINE／email 系統）
- 線上編輯文件、文件版本管理、自動重新同步 wiki 資料夾
- 部署、正式資料庫與向量資料庫、多人同時使用的效能
- 嵌入 megaweaving.net 網站的聊天小工具
