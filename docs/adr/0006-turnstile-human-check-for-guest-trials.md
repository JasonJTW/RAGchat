# 訪客試用以 Cloudflare Turnstile 擋機器人，每天驗證一次

任何人都能註冊成訪客，而訪客的每則訊息與上傳都會呼叫付費的 LLM。我們決定訪客要先通過 Cloudflare Turnstile 人機驗證才拿到試用工作區，驗證有效一天；再加上每人每日額度（訊息、上傳、單檔大小）、全體每日上限（`GUEST_DAILY_CAP`）與較便宜的 `GUEST_MODEL`。成員不經人機驗證。

## Considered Options

- **reCAPTCHA / hCaptcha**：拒絕；部署本來就在 Cloudflare（Tunnel、DNS），Turnstile 免費、多數情況不需使用者操作，也不把訪客交給廣告追蹤。
- **只靠額度不做人機驗證**：拒絕；註冊大量帳號就能繞過每人額度，只剩全體上限，一旦用完所有訪客都被擋。

## Consequences

- 驗證時只把 token 與 secret 送給 Cloudflare，不送 `remoteip`：server 在 Next rewrite 與 cloudflared 之後，看到的永遠是 web 容器的位址，轉送標頭又可被偽造。
- 測試與 E2E 以 `STUB_TURNSTILE=1`（token `stub-pass`）假冒，production 拒絕啟用。
- 沒設 `TURNSTILE_SECRET_KEY` 時沒有訪客能開始試用（啟動時警告）。
