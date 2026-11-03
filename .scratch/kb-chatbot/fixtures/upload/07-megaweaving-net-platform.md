# 07 megaweaving.net 平台

_最後更新：2026-11-03_

主要來源：
- 🅐 網站首頁 https://megaweaving.net/ 、英文版 https://megaweaving.net/en （2026-11-03 擷取）
- 🅐 GitHub 公開 repo https://github.com/JasonJTW/megaweave （README，以及 GitHub API 中繼資料，2026-11-03 查詢）
- 🅑 Substack／AYAD，2026-10-02 https://oxo816phoenix.substack.com/p/megaweaving

> 依 wiki 規範，本頁只記錄**已存在、可公開觀察**的功能。網站標示「即將推出」的項目另列，不混入現有功能。

## 定位

- 頁面標題：「megaweaving 大量交織｜免費物品交換與共享平台」
- 英文標語："free item exchange and sharing"
- README："a free item-exchange and materials-sharing platform"，起源是一個約 1.1 萬人的 Facebook 社團，因為原本的交換貼文「buried in an unsearchable feed」，所以做成可搜尋、以資料庫驅動的平台。
- Substack：平台希望讓「剛好」的媒合「不必全靠運氣」；供需兩端缺少的「往往不是物品，而是一條看得見彼此的路」。分享平台無法取代採購、回收或公共政策，「只是多提供一條路徑」。

## 核心流程（README）

| 角色／物件 | 意義 |
|---|---|
| **Share** | 「我有這個，拿去吧」 |
| **Wish** | 「我在找這個」 |
| **Weave** | 由另一方發起的一次交換：請求 → 核准 → 雙方確認 → 完成；可細到貼文中的個別物品 |
| Giver / Receiver | 交換雙方角色（定義在 repo 的 `CONTEXT.md`） |

- 交換本身**免費**，不涉及金錢。
- 唯一付費路徑：雙方無法面交時，可選用 **Lalamove 快遞配送**，以 **ECPay** 付款；快遞 webhook 遺失時，由對帳（reconciliation）工作補單。

## 網站可見功能（2026-11-03）

| 功能 | 中文 UI | 英文 UI | 狀態 |
|---|---|---|---|
| 發布需求 | + 許願 | + Wish | 上線 |
| 發布分享 | + 分享 | + Share | 上線 |
| 公共物品 | 地球公物 | Commons | **即將推出（Coming soon）** |
| 搜尋 | 搜尋欄 | Search | 上線 |
| 篩選 | 僅看許願／僅看分享／隱藏已過期/已結束 | Wish Only / Share Only / Hide Overdue | 上線 |
| 語言 | 繁體中文／English | — | 上線 |
| 導覽 | 關於我們（/about）、團隊介紹（/about#our-team） | About Us、megaweaving Team | 頁面靠 JS 載入（擷取時顯示「載入織友中...」），團隊名單未取得 |
| 社群連結 | FB 社團、IG @studio_megaweaving | 同左 | 上線 |
| 頁尾 | © megaweaving 2025；隱私權政策、服務條款 | 同左 | 條款連結目前都指向 `#`（尚未設置） |

## 功能清單（README 所述）

- **個人化動態**：在 Redis HNSW 向量索引上做語意檢索，再依相關性、熱門度、距離重新排序；新使用者看熱門內容
- **語意搜尋**：依語意而非關鍵字找貼文，可跨語言（例：英文 "plywood" 可找到中文木材貼文）；可依分類、地點、半徑篩選
- **滑動探索**：每次滑動都會更新使用者興趣檔案
- **即時功能**：聊天、通知、Weave 狀態更新（Socket.IO + Redis adapter）
- **配送與付款**：Lalamove + ECPay

## 技術架構（README）

| 層級 | 技術 |
|---|---|
| 前端 | Next.js 16（App Router）、React 19、TypeScript、Tailwind、Radix UI、SWR、Framer Motion |
| 後端 | Node.js、Express、TypeScript、Socket.IO、BullMQ、Zod |
| 資料 | MySQL 8、Redis 7、Redis Stack（RediSearch + HNSW） |
| 外部服務 | AWS S3 / CloudFront / Lambda、OpenAI embeddings、Resend、ECPay、Lalamove、Google Maps |
| 基礎設施 | Terraform（另一個 infra repo）、Docker Compose、GitHub Actions → GHCR → EC2、Sentry |

設計決策重點：
- 三個 Redis 實例（快取／工作佇列／向量索引）分開，各自採用不同的淘汰策略
- 動態「先排序、後補資料」：只對當頁約 12 篇貼文做昂貴的多表 join
- API 與 worker 共用映像檔；7 個 BullMQ 佇列（embedding、圖片、email、排名、配送對帳等）
- 降級而非失敗：embedding 不可用時退回關鍵字搜尋；熱門快取為空時直接讀 MySQL；向量索引遺失時開機從 MySQL 重建
- 測試：53 個 Jest 測試套件（金流簽章、快遞 API、RBAC、分散式限流、Weave 狀態轉換等）

## 開發時間線（GitHub API，2026-11-03 查詢）

| 項目 | 值 |
|---|---|
| Repo 擁有者 | JasonJTW |
| Repo 建立 | 2025-06-21T16:23:27Z |
| 第一個 commit | 2025-06-23T04:43:48Z — `feat(Initialize): Initialize app with core auth function` |
| 最近一次 push | 2026-10-30T11:16:35Z |
| main 分支 commit 數 | 648 |
| Open issues | 53 |
| Stars / Forks | 1 / 0 |
| 主要語言 | TypeScript |
| License | 未列出 |

## 與 FB 社團的關係

- 網站部分內容轉載自 FB 社團，有差異時「以原始貼文為準」。〔Substack〕
- 網站頁首與頁尾都連回 FB 社團與 IG。
- 公開資料中，**沒有任何一處明確寫出網站營運主體、團隊成員或與蕭有志的組織關係**。網站「團隊介紹」頁擷取時未載入，列為待補問題（見 [10](10-discrepancies-open-questions.md)）。

## 尚未取得的平台數據

以下數字在任何公開來源都找不到，不做推估：註冊會員數、上架物品數、完成交換（Weave）數、DAU/MAU、Lalamove 配送使用量。
