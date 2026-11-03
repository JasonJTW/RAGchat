# 01: 骨架：前台聊天、後台上傳，每一層先用假的

**What to build:** 用 `npm run dev` 一個指令同時起 web :3000 與 server :4000。瀏覽器只連 :3000，Next.js 把 `/api/*` 轉給 Express。前台 `/` 有聊天視窗：送出問題後，server 透過 AI SDK 的 UI message stream 逐字回一段固定的假回答，下面列一個假出處（data part）。後台 `/admin` 先不用登入，看得到文件列表和上傳按鈕：上傳任何檔案，列表就多一筆，顯示檔名、段落數 0。文件只存在記憶體，沒有切段、embedding，也不呼叫 LLM。`server/openapi.yaml` 寫上這張票新增的路由。

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] `npm run dev` 後打開 `http://localhost:3000/`，輸入任一問題送出，畫面逐字出現固定假回答，回答下方有 1 個出處
- [ ] 打開 `http://localhost:3000/admin`，上傳 `fixtures/upload/01-overview.md`，列表出現一筆「01-overview.md」，段落數 0
- [ ] 一支 Playwright E2E 跑過上面兩步，不需要 `AI_GATEWAY_API_KEY`
