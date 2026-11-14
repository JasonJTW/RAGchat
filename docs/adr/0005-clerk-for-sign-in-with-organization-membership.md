# 以 Clerk 登入，MegaWeaving Organization 的成員才是成員

知識庫的每個來源、提案與確認都要記下是誰做的，面試官等訪客也要能自行註冊試用。我們決定用 Clerk 處理登入（web 用 `@clerk/nextjs`，server 用 `@clerk/express`），以 Clerk 的 MegaWeaving Organization（`CLERK_MEMBER_ORG_ID`）判斷身分：其成員為成員，進團隊工作區；其他已登入者為訪客，只進自己的試用工作區。server 只透過 `identify(req)` / `callerOf(req)`（`server/src/auth.ts`、`server/src/workspaces.ts`）知道是誰，Clerk 不出這個接縫；顯示名稱也經同一接縫（`displayNames`）向 Clerk 查。

## Considered Options

- **自建帳號密碼（Auth.js 等）**：拒絕；要自己處理密碼、重設信與 OAuth，對四人團隊的 POC 是多餘的維運與資安負擔。
- **只用 Google 登入加網域白名單**：拒絕；成員不一定同網域，訪客也要能註冊，名單仍得自己維護。Organization 讓邀請與移除成員在 Clerk 後台完成。

## Consequences

- 成員身分查一次 Clerk 後快取一分鐘，從 Organization 移除的人一分鐘內失去成員身分；名稱快取十分鐘。Clerk 連不上時，需要身分的請求回 500，名稱退回顯示 id。
- 測試與 E2E 以 `STUB_AUTH=1` 的 cookie 假冒 Clerk；只要設了 `CLERK_SECRET_KEY` 或在 production 就拒絕啟用，避免留下後門。
- dev 與 production 是不同的 Clerk instance，Organization id 也不同（見 `docs/deploy.md`）。
- 使用者資料（名稱、信箱）留在 Clerk；資料庫只存 Clerk user id。
