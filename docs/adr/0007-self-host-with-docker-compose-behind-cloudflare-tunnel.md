# 自架在團隊的 Ubuntu 主機，Docker Compose 加 Cloudflare Tunnel 對外

知識庫存著團隊的會議內容與（加密的）個資對照表，團隊已有一台 Ubuntu 主機。我們決定全部自架在那台主機：一個 `docker-compose.prod.yml`（web、server、Postgres、Presidio、cloudflared）跑全部服務，對外只經 Cloudflare Tunnel 這條由內往外的連線，主機不開任何 port（web 只綁 `127.0.0.1`）；每日 `pg_dump` 備份到另一顆磁碟，並可用 rclone 送到異地。

## Considered Options

- **託管平台（Vercel ＋ 託管 Postgres）**：拒絕；資料與加密金鑰要放在第三方，Presidio 與 pgvector 也要另找地方跑，月費隨用量增加。
- **主機開 443 加反向代理（Caddy / nginx）**：拒絕；要管憑證與防火牆，主機 IP 直接暴露。Tunnel 免開 port，TLS 與 DDoS 防護交給 Cloudflare。

## Consequences

- 可用性取決於這一台主機與 Cloudflare；沒有備援，故障時以備份還原（`scripts/restore.sh`，`docs/deploy.md`）。
- 加密金鑰只在主機的 `.env`，不跟備份放在一起（ADR-0004）。
- 網域的 DNS 必須在 Cloudflare；Clerk 的 DNS 記錄設為 DNS only。
- 開發用的 `docker-compose.yml`（project `ragchat`）與 production（project `ragchat-prod`）分開，互不影響。
