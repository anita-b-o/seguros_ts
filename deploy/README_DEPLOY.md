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
sudo cp /srv/securests/app/deploy/securests-backend.service /etc/systemd/system/securests-backend.service
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

# CORS preflight
curl -i -X OPTIONS https://securests.com/api/health \
  -H "Origin: https://securests.com" \
  -H "Access-Control-Request-Method: GET"

# Logs
journalctl -u securests-backend -f
sudo tail -f /var/log/nginx/error.log
```

## Notes
- The backend module is `seguros`, so the WSGI target is `seguros.wsgi:application`.
- Static files are collected to `/srv/securests/app/backend/staticfiles`.
- If you enable media uploads, Nginx serves them from `/srv/securests/app/backend/media`.
