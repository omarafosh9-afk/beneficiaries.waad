#!/usr/bin/env bash
# يُشغَّل على السيرفر مرة واحدة: sudo bash deploy/server/setup.sh beneficiaries.den-op-ph.ly
# يفترض أن البيانات رُفعت مسبقًا إلى /opt/beneficiaries-data (انظر push-data.ps1).
set -euo pipefail
DOMAIN="${1:-beneficiaries.den-op-ph.ly}"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATA=/opt/beneficiaries-data
cd "$APP_DIR/deploy/server"

echo "== 1) فحص المنفذ 3102 والذاكرة"
if ss -ltn | grep -q ':3102 '; then echo "المنفذ 3102 مستخدم — غيّره في docker-compose.server.yml"; exit 1; fi
free -h | head -2

echo "== 2) المجلدات وسر الجلسات"
mkdir -p "$DATA/data" "$DATA/storage"
chown -R 1000:1000 "$DATA"            # المستخدم node داخل الحاوية
[ -f .env ] || echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
chmod 600 .env

echo "== 3) البناء والتشغيل"
docker compose -f docker-compose.server.yml build
if [ ! -f "$DATA/data/app.db" ]; then
  if [ -f "$DATA/data/people.json" ]; then
    docker compose -f docker-compose.server.yml run --rm beneficiaries node scripts/db-import.mjs
  else
    echo "لا يوجد $DATA/data/people.json — ارفع البيانات أولًا"; exit 1
  fi
fi
docker compose -f docker-compose.server.yml up -d

echo "== 4) Nginx"
sed "s/beneficiaries.den-op-ph.ly/$DOMAIN/g" nginx-beneficiaries.conf > /etc/nginx/sites-available/beneficiaries
ln -sf /etc/nginx/sites-available/beneficiaries /etc/nginx/sites-enabled/beneficiaries
nginx -t && systemctl reload nginx

echo "== 5) الشهادة"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect -m "${CERT_EMAIL:-admin@$DOMAIN}" || \
  echo "تعذّرت الشهادة الآن (تحقق من سجل DNS) ثم: certbot --nginx -d $DOMAIN"

echo
echo "تم. أنشئ أول مستخدم:"
echo "  docker compose -f $APP_DIR/deploy/server/docker-compose.server.yml exec beneficiaries node scripts/user-add.mjs --username tpa --name \"إدارة TPA\" --role tpa --password \"كلمة-قوية\""
echo "الرابط: https://$DOMAIN"
