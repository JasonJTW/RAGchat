# 單一 Postgres 承載向量、圖、時間與關鍵字檢索

知識庫的每一次寫入（確認提案、取代與過時、行內編輯、硬刪除來源、刪除訪客工作區）都同時改動事實文字、embedding、圖邊與有效時間，且確認時必須讀到「此刻」的知識庫再決定是否寫入。我們決定用單一 Postgres（pgvector 做向量、pg_trgm 做中文關鍵字、實體與關係表加遞迴 CTE 做圖、`valid_from`/`valid_to`/`recorded_at` 做雙時間），讓這些寫入落在同一個 transaction，工作區隔離、加密對照表與 `pg_dump` 備份也只需在一處做對。預估規模為每年數千則事實、上萬個 chunk，遠低於需要專用庫的量級。

## Considered Options

- **向量庫（Qdrant 等）＋圖資料庫（Neo4j）＋ Postgres**：拒絕。三者沒有共同 transaction，任何半套失敗都會讓過時事實繼續被檢索到，或讓硬刪除的敏感內容殘留；補救需要 outbox、重試與對帳。
- **Neo4j 包辦向量與圖**：拒絕。中文全文、雙時間與 transaction 模型都要自補，團隊也較不熟悉。

## Consequences

- 圖查詢限於以實體為中心往外 1–2 跳；不支援全域圖演算法（社群偵測、PageRank、GraphRAG 式摘要）。
- 若日後需要全域圖分析、數百萬則事實或多跳推理，Postgres 仍是唯一真相，另加 Neo4j/Qdrant 作為由 Postgres 同步的唯讀衍生索引，藏在檢索 retriever 之後，不推翻本決定。
