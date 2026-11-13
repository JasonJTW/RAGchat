# Server 全面改用 LangChain，agent 以 LangGraph StateGraph 明確建圖

kb-chatbot 的 server 用 Vercel AI SDK 呼叫模型；團隊 wiki 升級時，我們決定 server 的模型呼叫、embedding、工具與 agent 全部改用 LangChain JS，並以 LangGraph `StateGraph` 自己畫出節點與邊（去識別 → 判斷意圖 → 提問／輸入／修正分支 → 回填），而不是 `createAgent` 讓模型自行決定流程。理由是流程由程式碼決定、行為可預測，且每個節點是以 state 進出的純函式，可逐節點 TDD。Web 端保留 `@ai-sdk/react` 的 `useChat`，經 `@ai-sdk/langchain` 轉接 LangChain 串流，只把 AI SDK 留在 UI 層。

## Considered Options

- **保留 AI SDK**：拒絕；團隊希望以 LangChain 生態為主。
- **`createAgent`**：拒絕；程式碼少，但模型可能跳過檢索直接回答，且只能整體測試。
- **Web 改用 LangGraph SDK 的 `useStream`**：拒絕；它預期 LangGraph Server 的 API 協定，需另行實作或改用 LangGraph Platform。

## Consequences

- 檢索以自寫 SQL 實作並包成 LangChain `BaseRetriever`，不用 `PGVectorStore`（它不支援圖、雙時間與 trigram，見 ADR-0001）。
- 輸入分支是子圖，對話與直接上傳兩個入口共用。
- 模型建立集中在一個模組（`chatModel(purpose)`、`embeddings()`）；第一版經 AI Gateway 的 OpenAI 相容端點使用 `ChatOpenAI`/`OpenAIEmbeddings`，換廠商只改 env，需要廠商原生功能（如 Claude prompt caching）時只改該模組。
