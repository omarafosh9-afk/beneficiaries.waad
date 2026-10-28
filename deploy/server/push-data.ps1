# رفع البيانات من جهازك إلى السيرفر بأمر واحد:
#   .\deploy\server\push-data.ps1
# يستبدل بيانات السيرفر بقاعدة جهازك (data\app.db) وصورها، ويحتفظ بمستخدمي السيرفر وكلمات مرورهم.
# يوقف التطبيق، ويأخذ نسخة احتياطية من قاعدة السيرفر، ثم يحدّث البرنامج ويشغّله.
# انتبه: أي تعديل أُدخل على السيرفر نفسه بعد آخر رفع يُستبدل (يبقى في النسخة الاحتياطية فقط).
param([string]$Server = 'root@102.203.201.227', [switch]$Yes)
$ErrorActionPreference = 'Stop'

function Check($what) {
  if ($LASTEXITCODE -ne 0) { throw "فشل: $what (رمز $LASTEXITCODE)" }
}

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
if (-not (Test-Path "$root\data\app.db")) { throw "لا توجد قاعدة على جهازك: $root\data\app.db" }
if (-not $Yes) {
  Write-Host 'سيُستبدل كل بيانات المستفيدين على السيرفر ببيانات جهازك (المستخدمون يبقون).' -ForegroundColor Yellow
  if ((Read-Host 'اكتب y للمتابعة') -ne 'y') { Write-Host 'أُلغي.'; exit 1 }
}

$tmp = Join-Path $env:TEMP 'beneficiaries-upload'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

Write-Host '== 1/5 نسخة متسقة من قاعدة جهازك'
Push-Location $root
node --no-warnings scripts/db-snapshot.mjs (Join-Path $tmp 'app.db')
$code = $LASTEXITCODE
Pop-Location
$LASTEXITCODE = $code; Check 'نسخ قاعدة البيانات'

Write-Host '== 2/5 ضغط الصور (قد يأخذ دقيقة)'
# tar المدمج في Windows (وليس tar الخاص بـ Git الذي يعامل C: كجهاز بعيد).
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
& $tar -czf (Join-Path $tmp 'storage.tgz') -C "$root\public\storage" .
Check 'ضغط الصور'

Write-Host '== 3/5 الرفع'
ssh $Server 'mkdir -p /opt/beneficiaries-data/data/backups /opt/beneficiaries-data/storage'; Check 'إنشاء المجلدات'
scp (Join-Path $tmp 'app.db') "${Server}:/opt/beneficiaries-data/data/app.db.new"; Check 'رفع البيانات'
scp (Join-Path $tmp 'storage.tgz') "${Server}:/opt/beneficiaries-data/storage.tgz"; Check 'رفع الصور'

Write-Host '== 4/5 الاستبدال على السيرفر (مع نسخة احتياطية)'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remote = @"
set -e
cd /opt/beneficiaries/deploy/server
docker compose -f docker-compose.server.yml stop
cd /opt/beneficiaries-data/data
for f in app.db app.db-wal app.db-shm; do [ -f `$f ] && cp `$f backups/server-$stamp.`${f#app.}; done || true
[ -f backups/server-$stamp.db ] && echo 'backup: /opt/beneficiaries-data/data/backups/server-$stamp.db'
rm -f app.db-wal app.db-shm
mv app.db.new app.db
cd /opt/beneficiaries-data
tar -xzf storage.tgz -C storage && rm storage.tgz
chown -R 1000:1000 /opt/beneficiaries-data
"@
($remote -replace "`r", '') | ssh $Server 'bash -s'; Check 'الاستبدال على السيرفر'

Write-Host '== 5/5 تحديث البرنامج وإعادة المستخدمين'
ssh $Server "bash /opt/beneficiaries/deploy/server/update.sh && docker exec beneficiaries node --no-warnings scripts/keep-users.mjs /data/backups/server-$stamp.db"
Check 'التشغيل وإعادة المستخدمين'

Remove-Item $tmp -Recurse -Force
Write-Host 'تم رفع البيانات. حدّث الصفحة في المتصفح (Ctrl+F5).' -ForegroundColor Green
