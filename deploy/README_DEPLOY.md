# SecureSTS deployment (Ubuntu 24.04 + Nginx + systemd + Gunicorn)

This runbook uses real repo paths from this project:
- `manage.py` at `backend/manage.py`
- `requirements.txt` at `backend/requirements.txt`
- `package.json` at `frontend/package.json`

## 1) System packages
```bash
sudo apt update
sudo apt install -y python3-venv python3-pip nginx certbot python3-certbot-nginx redis-server postgresql
```

## 2) User + directories
```bash
sudo useradd -r -s /bin/false securests
sudo mkdir -p /srv/securests/app /etc/securests
sudo chown -R securests:www-data /srv/securests
sudo chmod 750 /srv/securests
```

## 3) Code
```bash
sudo -u securests git clone <repo> /srv/securests/app
```

## 4) Python venv + deps
```bash
sudo -u securests python3 -m venv /srv/securests/venv
sudo -u securests /srv/securests/venv/bin/pip install -r /srv/securests/app/backend/requirements.txt
```

## 5) Environment files
```bash
sudo cp /srv/securests/app/deploy/backend.env.production.example /etc/securests/backend.env
sudo nano /etc/securests/backend.env

sudo cp /srv/securests/app/deploy/frontend.env.production.example /etc/securests/frontend.env
sudo nano /etc/securests/frontend.env
```

## 6) PostgreSQL
```bash
sudo -u postgres psql -c "CREATE USER securests WITH PASSWORD 'changeme';"
sudo -u postgres psql -c "CREATE DATABASE securests OWNER securests;"
```

## 7) Django migrate + collectstatic
```bash
cd /srv/securests/app/backend
sudo -u securests /srv/securests/venv/bin/python manage.py migrate
sudo -u securests /srv/securests/venv/bin/python manage.py collectstatic --noinput
```

## 8) Django deploy check
```bash
cd /srv/securests/app/backend
sudo -u securests env $(cat /etc/securests/backend.env | xargs) /srv/securests/venv/bin/python manage.py check --deploy
```

## 9) Frontend build
```bash
cd /srv/securests/app/frontend
export $(cat /etc/securests/frontend.env | xargs) 2>/dev/null || true
npm ci
npm run build
```

Nginx serves the built files directly from:
- `/srv/securests/app/frontend/dist`

## 10) systemd service
```bash
sudo cp /srv/securests/app/deploy/securests-backend.service.example /etc/systemd/system/securests-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now securests-backend
sudo systemctl status securests-backend
```

## 11) Nginx + TLS
```bash
sudo cp /srv/securests/app/deploy/securests.com.nginx /etc/nginx/sites-available/securests.com
sudo ln -s /etc/nginx/sites-available/securests.com /etc/nginx/sites-enabled/securests.com
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d securests.com -d www.securests.com
```

## 12) Verification
```bash
curl -i https://securests.com/api/health
curl -i https://securests.com/api/health/live

# CORS preflight
curl -i -X OPTIONS https://securests.com/api/health \
  -H "Origin: https://securests.com" \
  -H "Access-Control-Request-Method: GET"

# Logs
journalctl -u securests-backend -f
sudo tail -f /var/log/nginx/error.log
```

Health endpoints behavior:
- `/api/health` and `/healthz` are **readiness** checks (DB + Redis).
- `/api/health/live` and `/healthz/live` are **liveness** checks (process up).
- Readiness returns `503` when dependencies fail (unless `HEALTHCHECK_FAIL_OPEN=true`).
- `HEALTHCHECK_INCLUDE_DETAILS=false` hides per-dependency details in prod responses.

## 12.1) Operational monitoring and alerting
- Keep `/metrics` private behind network ACL or auth.
- Import alert rules from `deploy/prometheus-alerts.yml`.
- Recommended minimum alerts:
- backend down (`up == 0`)
- high 5xx ratio (`http_5xx_app_total`)
- high p95 latency (`http_request_app_duration_seconds`)
- webhook ingestion/processing mismatch (`webhooks_received_total` vs `webhooks_processed_total`)
- invalid webhook signature spike (`webhooks_invalid_signature_total`)

## 12.2) Centralized traceability (logs + correlation)
- Backend emits structured JSON logs to stdout with `request_id`.
- Every response includes `X-Request-ID`; preserve this header in reverse proxy and client logs.
- Ship logs from `journalctl -u securests-backend` and Nginx to a central backend (Loki/ELK/Cloud Logging).
- Suggested key fields to index: `request_id`, `status_code`, `path`, `route`, `duration_ms`, `user_id`, `client_ip`.
- In incidents, correlate API and Nginx lines by `request_id` + timestamp window.

## 13) Backups and restore (required for production)
### Scope
- PostgreSQL logical dump (`pg_dump -Fc`) for full application data.
- Media filesystem backup (`MEDIA_ROOT`, default `/srv/securests/app/backend/media`) when local media is used.
- Backup metadata + checksums (`SHA256SUMS`) for integrity verification.

### RPO / RTO target
- Recommended baseline:
- RPO: 24h (daily full backup).
- RTO: 60-120 min (DB restore + media restore + service validation).
- If your business requires lower RPO, add WAL archiving or increase backup frequency.

### Automation scripts included
- `deploy/backup_securests.sh`
- `deploy/restore_securests.sh`

### One-time setup
```bash
cd /srv/securests/app
chmod +x deploy/backup_securests.sh deploy/restore_securests.sh
sudo mkdir -p /srv/securests/backups/prod
sudo chown -R securests:www-data /srv/securests/backups
sudo chmod -R 750 /srv/securests/backups
```

### Daily automated backup (cron example)
```bash
# Runs every day at 02:30 UTC, keeps 14 days by default
30 2 * * * cd /srv/securests/app && ./deploy/backup_securests.sh >> /var/log/securests-backup.log 2>&1
```

### Manual backup
```bash
cd /srv/securests/app
./deploy/backup_securests.sh
```

### Restore procedure (runbook)
1. Put application in maintenance mode or block write traffic.
2. Restore DB:
```bash
cd /srv/securests/app
./deploy/restore_securests.sh \
  --db-backup /srv/securests/backups/prod/<timestamp>/postgres.dump \
  --force
```
3. Optional media restore:
```bash
cd /srv/securests/app
./deploy/restore_securests.sh \
  --db-backup /srv/securests/backups/prod/<timestamp>/postgres.dump \
  --media-backup /srv/securests/backups/prod/<timestamp>/media.tar.gz \
  --restore-media \
  --force
```
4. Validate:
```bash
curl -i https://securests.com/api/health
sudo systemctl status securests-backend --no-pager
```

### Backup validation policy
- Validate checksums after each backup:
```bash
cd /srv/securests/backups/prod/<timestamp>
sha256sum -c SHA256SUMS
```
- Run at least one restore drill per month in staging (DB + media) and record result/time.

### Offsite copy policy
- Local disk backup is not enough for disaster recovery.
- Replicate `/srv/securests/backups/prod` to offsite storage (S3/B2/another region) on each backup run.
- Keep at least one immutable/offline copy according to your compliance requirements.

### Automated backup + offsite + restore-check (continuous operation)
Scripts:
- `deploy/backup_ops_securests.sh`: runs local backup, verifies checksum, and syncs latest backup offsite (rsync/SSH).
- `deploy/restore_check_securests.sh`: validates latest backup age/checksum and runs a disposable DB restore drill.
- `deploy/backup-ops.env.example`: config template (copy to `/etc/securests/backup-ops.env`).

Setup:
```bash
cd /srv/securests/app
chmod +x deploy/backup_ops_securests.sh deploy/restore_check_securests.sh
sudo cp deploy/backup-ops.env.example /etc/securests/backup-ops.env
sudo chown securests:www-data /etc/securests/backup-ops.env
sudo chmod 640 /etc/securests/backup-ops.env
sudo nano /etc/securests/backup-ops.env
```

Required for offsite:
- `OFFSITE_ENABLED=true`
- `OFFSITE_RSYNC_TARGET=backup@backup-host:/data/securests-backups`
- Optional hardening via `OFFSITE_SSH_OPTS` (identity file and strict host key checking).

Recommended cron (user `deploy`):
```bash
30 2 * * * cd /srv/securests/app && ./deploy/backup_ops_securests.sh >> /var/log/securests-backup-ops.log 2>&1
45 3 * * 0 cd /srv/securests/app && ./deploy/restore_check_securests.sh >> /var/log/securests-restore-check.log 2>&1
```

## Notes
- The backend module is `seguros`, so the WSGI target is `seguros.wsgi:application`.
- Static files are collected to `/srv/securests/app/backend/staticfiles`.
- If you enable media uploads, Nginx serves them from `/srv/securests/app/backend/media`.

## GitHub Actions deploy pipeline
`/.github/workflows/release.yml` now performs a real deploy:
- `main` branch pushes deploy to `staging`
- `v*` tags deploy to `production`
- `workflow_dispatch` lets you pick `staging` or `production`
- each deploy does backup + migrate + collectstatic + service restart + healthcheck
- if any step fails, rollback is executed automatically

Create GitHub Environments named `staging` and `production` and define:

Secrets:
- `DEPLOY_SSH_HOST`
- `DEPLOY_SSH_USER`
- `DEPLOY_SSH_KEY` (private key with server access)

Variables (optional, defaults already exist in workflow):
- `DEPLOY_SSH_PORT` (default `22`)
- `DEPLOY_BASE_PATH` (default `/srv/securests`)
- `DEPLOY_BACKEND_ENV_FILE` (default `/etc/securests/backend.env`)
- `DEPLOY_SERVICE_NAME` (default `securests-backend`)
- `DEPLOY_HEALTHCHECK_URL` (default `https://securests.com/api/health`)
- `DEPLOY_NGINX_RELOAD` (`true`/`false`, default `true`)

Server prerequisites for pipeline:
- target host has `rsync`, `curl`, `tar`
- user can run `sudo systemctl restart <service>` (and optional `sudo systemctl reload nginx`)
- Python venv exists at `/srv/securests/venv`
