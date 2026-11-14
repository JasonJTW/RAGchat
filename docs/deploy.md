# Deploying on the team's Ubuntu server

Runbook for production: first deployment, updates, daily backups and restores. Everything runs from one Compose file, `docker-compose.prod.yml` (project `ragchat-prod`): web, server, Postgres (`pgvector/pgvector`), Presidio Analyzer, and `cloudflared`. The host opens no port: Cloudflare Tunnel is an outbound connection, and the web container is bound to `127.0.0.1` only. The dev/test `docker-compose.yml` (project `ragchat`) is separate and unchanged.

Commands below assume the checkout is `/opt/ragchat` and a deploy user `ragchat`. Shorthand:

```sh
alias prod='docker compose -f /opt/ragchat/docker-compose.prod.yml'
```

## Human checklist

These steps need a person with access to the dashboards. Tick them off in #39.

- [ ] **Domain**: pick the hostname (e.g. `wiki.example.com`). Its zone must be on Cloudflare, because the tunnel's DNS record is created there.
- [ ] **Cloudflare Tunnel**: Zero Trust › Networks › Tunnels › _Create a tunnel_ (cloudflared). Copy the token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN` and set `COMPOSE_PROFILES=tunnel`. Add a public hostname: the domain above → service `HTTP` `web:3000`.
- [ ] **Clerk production instance**: in the Clerk dashboard, create the production instance for the domain and add the DNS records Clerk lists (in Cloudflare, **DNS only**, not proxied). Google sign-in in production needs your own Google OAuth client: create one in Google Cloud Console with the redirect URI Clerk shows, and paste its id and secret into Clerk. Create the MegaWeaving Organization **in the production instance** and invite the 成員: its id differs from the dev one. Put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_…`), `CLERK_SECRET_KEY` (`sk_live_…`) and `CLERK_MEMBER_ORG_ID` into `.env`.
- [ ] **Turnstile production keys**: Cloudflare › Turnstile › _Add widget_ for the domain. Replace the test keys with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
- [ ] **Encryption key**: generate `PSEUDONYM_ENCRYPTION_KEY`, save it in the team's password manager (see [The encryption key](#the-encryption-key)), and record there who holds it.
- [ ] **Backup disk**: mount a disk other than the system disk and set `BACKUP_DIR` to a directory on it.
- [ ] **Off-site backup remote**: create a bucket or folder (Backblaze B2, S3, Google Drive…), run `rclone config` as the deploy user, and set `BACKUP_RCLONE_REMOTE`. Prefer an rclone `crypt` remote over it: a dump holds pseudonyms, not real names, but it is still the team's knowledge base.
- [ ] **First deployment** (below), then **one restore** from a real backup ([Restore](#restore)).
- [ ] **First sign-in check**: at `https://<domain>`, sign in with Google as a 成員 (a member of the Organization): the chat and 待確認 pages open, and an answer cites the knowledge base. Then sign in with a Google account outside the Organization: it is a 訪客 with its own trial workspace (demo data), not the team's.
- [ ] **No open ports**: from another network, `nmap -Pn <server public IP>` shows nothing but SSH (or nothing, if SSH goes through the tunnel too).

## Server preparation

Ubuntu 24.04 LTS, at least 4 GB RAM (Presidio alone takes about 1 GB) and 20 GB free disk.

```sh
# Docker Engine and the Compose plugin (https://docs.docker.com/engine/install/ubuntu/)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git rclone
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# The deploy user runs Compose and the backups.
sudo adduser --disabled-password --gecos "" ragchat
sudo usermod -aG docker ragchat

# Firewall: nothing comes in except SSH. (Compose publishes web on 127.0.0.1 only.)
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable

# Checkout
sudo mkdir -p /opt/ragchat && sudo chown ragchat: /opt/ragchat
sudo -u ragchat git clone https://github.com/JasonJTW/RAGchat.git /opt/ragchat
```

## The `.env`

One file, `/opt/ragchat/.env`, readable by the deploy user only. Start from the template:

```sh
cd /opt/ragchat
cp .env.example .env
chmod 600 .env
openssl rand -base64 32   # → PSEUDONYM_ENCRYPTION_KEY
openssl rand -hex 24      # → POSTGRES_PASSWORD
```

Fill in:

| Variable                                                                                                      | Value                         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `AI_GATEWAY_API_KEY`, `CHAT_MODEL`, `EMBEDDING_MODEL`, optional `JEV_API_KEY`, `EXTRACT_MODEL`, `GUEST_MODEL` | as in development             |
| `POSTGRES_PASSWORD`                                                                                           | the hex string above          |
| `PSEUDONYM_ENCRYPTION_KEY`                                                                                    | the base64 string above       |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_MEMBER_ORG_ID`                                | Clerk **production** instance |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                                                      | Turnstile production widget   |
| `WEB_ORIGIN`                                                                                                  | `https://<domain>`            |
| `CLOUDFLARE_TUNNEL_TOKEN`, `COMPOSE_PROFILES=tunnel`                                                          | Cloudflare Tunnel             |
| `BACKUP_DIR`, optional `BACKUP_RCLONE_REMOTE`                                                                 | see [Backups](#backups)       |

Leave out `DATABASE_URL`, `PRESIDIO_URL`, `PII_ANALYZER`, `STUB_AUTH`, `STUB_MODELS` and `STUB_TURNSTILE`: Compose sets the first two to its own services and turns the test switches off.

`NEXT_PUBLIC_*` values are built into the web image. After changing one, rebuild: `prod up -d --build --wait`.

### The encryption key

`PSEUDONYM_ENCRYPTION_KEY` is the only thing that turns the pseudonyms in the knowledge base (〔人名3〕) back into real names, phone numbers and addresses (ADR-0004).

- It lives in two places only: the host's `.env` (mode 600) and the team's password manager (entry "RAGchat PSEUDONYM_ENCRYPTION_KEY", with the date it was created).
- Never next to the backups: not in `BACKUP_DIR`, not on the rclone remote. `scripts/backup.sh` refuses a `BACKUP_DIR` that holds the `.env`, sits above it, or has a file containing the key. A stolen dump then shows pseudonyms only.
- Lose it and every real value is gone for good; the knowledge base keeps working with pseudonyms only.
- Never change it on a database that already has pseudonyms: there is no rotation tool yet, and the old values become unreadable.
- Restoring onto a new server needs the backup **and** the key from the password manager.

## First deployment

```sh
cd /opt/ragchat
prod up -d --build --wait
prod ps
```

The server applies database migrations on start. `--wait` returns once every service is healthy (the first start pulls Presidio, about 1 GB). Then, on the host:

```sh
curl -sI http://127.0.0.1:3000/sign-in   # 200
curl -s http://127.0.0.1:3000/api/me     # {"error":"sign in first"}
prod logs cloudflared --tail 20          # "Registered tunnel connection"
```

and open `https://<domain>` for the sign-in check in the checklist. Install the backup timer next ([Backups](#backups)).

Without a tunnel token (e.g. trying it on a laptop), leave `COMPOSE_PROFILES` unset: everything but `cloudflared` starts, and the site is at `http://localhost:3000` (`WEB_PORT` changes the port).

## Updating

```sh
cd /opt/ragchat
sudo systemctl start ragchat-backup.service   # a fresh backup first
git pull
prod up -d --build --wait
prod image prune -f
```

Migrations run when the new server starts. If it doesn't come up healthy, `prod logs server`; to go back, `git checkout <previous commit>` and `prod up -d --build --wait` (a migration that already ran stays: restore the backup if the old code can't use it).

## Backups

`scripts/backup.sh` runs `pg_dump` inside the Postgres container (no Postgres client on the host), and:

1. writes `ragchat-YYYYMMDD-HHMMSS.dump` (UTC, `pg_dump --format=custom`, mode 600) into `BACKUP_DIR`;
2. deletes its dumps older than 14 days there;
3. if `BACKUP_RCLONE_REMOTE` is set, copies the new dump there and deletes remote dumps older than 14 days. Unset, this step is skipped.

It exits non-zero (and the systemd unit shows _failed_) if any step fails, leaving no partial dump. Presidio is stateless, so the database is everything to back up.

```sh
sudo mkdir -p /mnt/backup/ragchat && sudo chown ragchat: /mnt/backup/ragchat && sudo chmod 700 /mnt/backup/ragchat
# .env: BACKUP_DIR=/mnt/backup/ragchat  (and BACKUP_RCLONE_REMOTE=offsite:ragchat)
sudo -u ragchat /opt/ragchat/scripts/backup.sh   # try it once by hand
```

Daily at 03:30 with a systemd timer (edit `User=` and the paths in the unit first if yours differ):

```sh
sudo cp /opt/ragchat/scripts/systemd/ragchat-backup.service /opt/ragchat/scripts/systemd/ragchat-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ragchat-backup.timer
systemctl list-timers ragchat-backup.timer     # next run
journalctl -u ragchat-backup.service -n 20     # last runs
```

Cron instead of systemd (`crontab -e` as `ragchat`):

```
30 3 * * * /opt/ragchat/scripts/backup.sh >> /home/ragchat/backup.log 2>&1
```

Check now and then that the newest dump is from today: `ls -lt "$BACKUP_DIR" | head -3` and `rclone lsl "$BACKUP_RCLONE_REMOTE" | sort -k2,3 | tail -3`.

## Restore

`scripts/restore.sh` restores a dump into a **new** database (`ragchat_restored` by default); it never overwrites one. The live database is swapped only after the restored one checks out, and the old one is kept until you drop it.

```sh
cd /opt/ragchat
# 1. Pick a dump (from the remote: rclone copy offsite:ragchat/ragchat-….dump /tmp/)
ls -lt "$BACKUP_DIR" | head
scripts/restore.sh "$BACKUP_DIR/ragchat-YYYYMMDD-HHMMSS.dump"

# 2. Check it: row counts look right
prod exec postgres psql -U ragchat -d ragchat_restored -c "select (select count(*) from facts) facts, (select count(*) from sources) sources, (select count(*) from pseudonyms) pseudonyms"

# 3. Swap it in
prod stop web server
prod exec postgres psql -U ragchat -d postgres --single-transaction -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE ragchat RENAME TO ragchat_before_restore" \
  -c "ALTER DATABASE ragchat_restored RENAME TO ragchat"
prod up -d --wait

# 4. Sign in and ask a question that names a person: the answer shows the real
#    name, so the key in .env matches the dump. Then drop the old database:
prod exec postgres psql -U ragchat -d postgres -c "DROP DATABASE ragchat_before_restore"
```

On a new server: prepare it as above, put the **same** `PSEUDONYM_ENCRYPTION_KEY` (password manager) into `.env`, `prod up -d --wait` once to create the empty database, then restore as above.

To practise a restore without touching the live database, stop after step 2 and drop it: `prod exec postgres psql -U ragchat -d postgres -c "DROP DATABASE ragchat_restored"`.
