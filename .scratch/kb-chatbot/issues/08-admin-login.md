# 08: 後台登入

**What to build:** `/admin` 和所有後台 API 都要登入。登入畫面比對 `server/.env` 的 `ADMIN_USERNAME`（預設 `admin`）和 `ADMIN_PASSWORD`，成功就發 httpOnly session cookie；session 存在記憶體，server 重啟要重新登入。因為 `/api/*` 由 Next.js 轉發，cookie 是同源的。前台聊天頁不用登入。`server/openapi.yaml` 寫上登入路由與後台路由的 401。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 沒登入打開 `/admin`，被導到登入畫面
- [ ] 輸入 `admin` 和錯誤密碼，顯示「帳號或密碼錯誤」，仍停在登入畫面
- [ ] 輸入正確密碼，進入後台看到文件列表
- [ ] 沒登入時直接呼叫上傳或刪除的後台 API，回 401；前台聊天 API 不受影響
