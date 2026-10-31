# Storage Infrastructure Requirements

Status: **Server is suitable for persistent media; production migration still blocked on backups (G5) and environment confirmation.** See §0.

## 0. Infrastructure decision report (2026-10-31)

Source: read-only audit output from `srv2104110` run by the owner (`~/storage-audit.txt`). No changes were made to the server. The tools, listening-ports and backup/timer sections were not included in the pasted output.

| # | Answer | Evidence |
|---|---|---|
| G1 | **VPS with root.** Ubuntu 24.04.5 LTS, 4 vCPU, 15 GiB RAM (13 GiB available), 2 GiB swap. Nginx 1.30.6 managed by **CloudPanel** (`/home/<site>/htdocs/...` roots, `@reverse_proxy`). | os-release, free, nginx -T |
| G2 | **Yes.** `/` is a persistent ext4 disk (`/dev/sda1`). Deploys are an in-place `git pull` in `/root/bulkimart` plus rsync of the frontend to `/home/bulkimart/htdocs/bulkimart.in`; nothing touches `/var/lib`. `/var/lib/bulkimart` does not exist yet. | df, findmnt, deploy.sh |
| G3 | 193 GB disk, **183 GB free (6% used)**, inodes 2% used. **Single disk, no separate volume**: `/`, `/var` and the repo share `/dev/sda1`, so a full media store could fill the OS disk → enforce `MEDIA_MIN_FREE_BYTES`. | df -hT, df -i, lsblk |
| G4 | Unknown (Hostinger plan bandwidth). Not blocking. | — |
| G5 | **No file backups configured on the server.** Only OS timers (`dpkg-db-backup`, logrotate, etc.) and `clp-update`; no restic/borg; `rclone` and `rsync` are installed but unscheduled. Hostinger panel snapshots not yet confirmed. **Blocking for production migration.** | crontab, cron.d, systemd timers |
| G6 | **Yes**, via CloudPanel's per-site Vhost editor (edit there, not `sites-enabled/*.conf` directly, or CloudPanel may overwrite). Already in place: global `client_max_body_size 64M` (≥ 60 MB needed), API `proxy_read_timeout`/`proxy_send_timeout 900`. | nginx -T |
| G7 | **1 instance**, PM2 `bulkimart-api`, `fork_mode`, cwd `/root/bulkimart/backend` → local disk storage is valid. | pm2 jlist |
| G8 | Node process runs as **root**. A media directory works, but file-permission separation is weaker than recommended; moving PM2 to a dedicated user is a separate hardening task, out of scope. | pm2 jlist |
| G9 | **ffmpeg/ffprobe not installed.** Storefront video checks must use in-process MP4/WebM header parsing (architecture decision D3, "validate, don't transcode"); installing ffmpeg needs owner approval. | which |
| G10 | Not provided yet (Cloudinary dashboard). | — |

Other findings:
- **Domains:** `api.bulkimart.in` → `127.0.0.1:5050` (the API); `bulkimart.in` serves the built frontend statically from CloudPanel's web root. The backend's `forntend/dist` static serving is inactive on this server (folder does not exist), so the SPA catch-all issue (security F3) does not apply here; `/uploads` URLs simply 404 at the API.
- **`NODE_ENV=development`** in `backend/.env` (not set in the PM2 env), and **`EBOOK_STORAGE_DIR` / `SERVICE_STORAGE_DIR` are unset**. In development mode both stores silently default to `/root/bulkimart/backend/private-data/{ebooks,services}` — inside the repository. Neither directory exists yet, so no e-books or service documents have been uploaded; the first one would land in the repo tree. Both variables should point at `/var/lib/bulkimart/{ebooks,services}` before anyone uploads.
- MongoDB is not local (no listener on 27017), so metadata backups depend on the hosted database's own backup policy (to confirm).
- Outside storage scope, noted for the owner: the API listens on `0.0.0.0:5050` (reachable directly, bypassing Nginx, unless a firewall blocks it) and MySQL listens on all interfaces (`*:3306`). Running a public server with `NODE_ENV=development` also enables dev logging. Not changed here.
- The server's `deploy.sh` is a locally modified "TESTING DEPLOYMENT" script (backs up the web root to `/root/bulkimart-deploy-backups`), different from the repo copy.
- The VPS appears freshly provisioned (cloud-init media dated 2026-10-28; uptime 3 days).

**Decision:** this server can host persistent media under `/var/lib/bulkimart/media` for the current scale (one instance, 183 GB free). Implementation and staging-style testing may proceed once the owner approves the location. **Production migration of existing assets waits for G5** (off-server backups with a tested restore).

## 1. What the repository tells us (static evidence only)

| Item | Evidence | Concern |
|---|---|---|
| Host | Hostinger; traffic through one reverse proxy (Nginx/LiteSpeed) — [index.js:50-54](../backend/index.js#L50-L54), [SERVICE_MANAGEMENT.md](../SERVICE_MANAGEMENT.md) | Plan type unknown. Managed Node.js hosting often gives limited disk, no root, no Nginx config, no ffmpeg. |
| Deploy directory | Docs describe a `nodejs/` release directory whose prior contents can be lost ([EBOOK_STORAGE.md](../EBOOK_STORAGE.md) "copy every UUID-named PDF from the prior release's `nodejs/private-data/ebooks/`") | Anything under the backend directory — including today's `backend/uploads/` fallback — must be assumed **non-persistent**. |
| Process model | PM2 single named process ([deploy.sh](../deploy.sh)); Socket.IO in-process | Local disk is fine for one instance; multiple instances need a shared volume. |
| Existing private stores | `EBOOK_STORAGE_DIR`, `SERVICE_STORAGE_DIR` required in production; suggested `/var/lib/bulkimart/services` | Confirms the intended pattern — a persistent path outside the release. Whether that path exists on the real server is unverified. |
| Frontend path | `index.js` and `deploy.sh` use `forntend/`, the repo has `frontend/` | Confirm what exists on the server before adding static-media routing. |

## 2. Gate checklist (must be answered by the server owner)

| # | Question | Needed answer |
|---|---|---|
| G1 | Hosting type: VPS/dedicated with root, or managed Node.js/shared hosting? | VPS/dedicated with root **strongly preferred** |
| G2 | Is there a path outside the deploy directory that survives redeploys, restarts and plan migrations? (e.g. `/var/lib/bulkimart`) | Yes, with path |
| G3 | Total and free disk on that path; is it a separate volume/partition? | Numbers; separate volume preferred so media cannot fill the OS disk |
| G4 | Monthly bandwidth/transfer allowance | Number |
| G5 | Backup: what is backed up today, how often, where, retention, last tested restore? | Daily offsite, ≥ 30 days, tested |
| G6 | Can we edit Nginx (or equivalent) config: body size, timeouts, static `alias`, `internal` locations? | Yes / no |
| G7 | Number of backend instances now and planned | 1, or shared storage |
| G8 | OS user running the Node process; can we create a dedicated directory owned by it with 0700? | Yes |
| G9 | Is ffmpeg installable? (only if decision D3 chooses transcoding) | Yes / no |
| G10 | Current Cloudinary usage: storage GB, monthly bandwidth, asset count (dashboard → Usage) | Numbers — feeds the capacity estimate |

**If G1 is "managed/shared hosting" or G2 is "no":** stop. Recommendation is to provision a small VPS (or add a block-storage volume to the existing VPS) dedicated to the API + media before migrating, rather than storing media on non-durable disk. Per the brief, we do not silently switch to another cloud provider.

## 3. Capacity estimate

Fill in after the read-only inventory (migration plan §2) and Cloudinary usage numbers:

```
required_now   = existing_cloudinary_original_bytes (referenced assets only)
               + backend/uploads fallback bytes
               + EBOOK_STORAGE_DIR + SERVICE_STORAGE_DIR bytes
monthly_growth = (avg new products/month × avg images × avg image size after re-encode ≈ 150–400 KB)
               + KYC onboarding/month × ~4 docs × ~1 MB
               + returns + tickets attachments/month × avg size
               + e-books/month × avg size
               + storefront videos/month × ≤15 MB
provision      = (required_now + 24 × monthly_growth) × 1.5   (headroom, replaced-file grace, .tmp)
               + 2× largest single upload for .tmp
```

Alert thresholds: warn 70%, critical 85%, uploads refused at 95% (or < 2 GB free) via `MEDIA_MIN_FREE_BYTES`.

## 4. Required server configuration (once G1/G2 pass)

### Directories
```
/var/lib/bulkimart/media/{public,private,.tmp}   owner: <service user>, public 0750, private 0700, .tmp 0700
/var/lib/bulkimart/ebooks                         EBOOK_STORAGE_DIR (move from source-relative default if used)
/var/lib/bulkimart/services                       SERVICE_STORAGE_DIR
```
Not inside the git checkout, the PM2 cwd, `frontend/dist`, or any web root.

### Environment
```
MEDIA_ROOT=/var/lib/bulkimart/media
MEDIA_PUBLIC_BASE_URL=https://media.<domain>      # or empty for same-origin /media
MEDIA_SIGNING_SECRET=<32+ random bytes>           # new secret, not reused
MEDIA_MIN_FREE_BYTES=2147483648
MEDIA_PROVIDERS={"seller.kyc":"cloudinary",...}   # all cloudinary at first deploy
IMAGE_SEARCH_CATALOG_ORIGINS=https://media.<domain>
```

### Reverse proxy (Nginx example; adapt for LiteSpeed)
```nginx
client_max_body_size 60m;          # bulk ZIP 50 MB + multipart overhead
client_body_timeout 120s;
proxy_read_timeout 120s;
proxy_request_buffering on;        # proxy absorbs slow mobile uploads

server_name media.<domain>;
location /media/ {
  alias /var/lib/bulkimart/media/public/;
  autoindex off;
  add_header Cache-Control "public, max-age=31536000, immutable";
  add_header X-Content-Type-Options nosniff;
  add_header Content-Security-Policy "default-src 'none'; sandbox";
  types { image/webp webp; image/jpeg jpg jpeg; image/png png; video/mp4 mp4; video/webm webm; }
  default_type application/octet-stream;
}
location /_private_media/ {        # only reachable via X-Accel-Redirect from Node
  internal;
  alias /var/lib/bulkimart/media/private/;
  add_header Cache-Control "private, no-store";
}
```
If the proxy cannot be configured (G6 = no), Node serves both public and private media itself with the same headers; acceptable at current scale.

### Backups
- Nightly incremental backup (e.g. restic/borg) of `/var/lib/bulkimart` to offsite storage, encrypted; ≥ 30 daily + 12 monthly.
- Same schedule as MongoDB backups so metadata and files can be restored to a consistent point.
- Quarterly restore drill to a scratch volume with hash verification of a sample.

### Monitoring
- Disk free on the media volume (alerts at thresholds in §3).
- `.tmp` size and age (sweeper health).
- `/api/admin/media/health` polled by uptime monitoring.
- 4xx/5xx rates on media routes; KYC audit volume anomalies.

### Deployment behaviour
- `deploy.sh` must not touch `/var/lib/bulkimart`. Add a pre-restart check that `MEDIA_ROOT` exists, is writable and is not inside `REPO_DIR` (mirrors the backend startup check).

## 5. Disaster recovery

| Scenario | Recovery |
|---|---|
| Accidental deletion of a file | Restore from last nightly backup; `Media.sha256` confirms correctness |
| Disk failure | Provision new volume, restore backup, restore Mongo to same point |
| Disk full | Uploads refused cleanly (507); expand volume; cleanup job for replaced files |
| Server loss | New server + restore; DNS for `media.` subdomain |
| During migration | Cloudinary originals retained until approved cleanup — they are the fallback copy |
