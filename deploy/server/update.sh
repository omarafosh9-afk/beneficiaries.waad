#!/usr/bin/env bash
# تحديث البرنامج على السيرفر (البيانات لا تُمس): bash /opt/beneficiaries/deploy/server/update.sh [الفرع]
set -euo pipefail
cd "$(dirname "$0")/../.."
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
echo "== سحب آخر نسخة ($BRANCH)"
git fetch -q origin
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
echo "== البناء والتشغيل"
cd deploy/server
docker compose -f docker-compose.server.yml up -d --build
docker image prune -f >/dev/null
echo "تم: $(git log --oneline -1)"
