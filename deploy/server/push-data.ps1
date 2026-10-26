# يُشغَّل على جهازك (Windows) لرفع البيانات والصور إلى السيرفر:
#   .\deploy\server\push-data.ps1 -Server root@102.203.201.227
# يرفع: قاعدة البيانات الحالية (data\app.db، بكل التصحيحات) ومجلد الصور public\storage
# إلى /opt/beneficiaries-data. إن لم توجد القاعدة يرفع data\people.json بدلها.
param([Parameter(Mandatory = $true)][string]$Server)
$ErrorActionPreference = 'Stop'

function Check($what) {
  if ($LASTEXITCODE -ne 0) { throw "فشل: $what (رمز $LASTEXITCODE)" }
}

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$tmp = Join-Path $env:TEMP 'beneficiaries-upload'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

if (Test-Path "$root\data\app.db") {
  Write-Host '== نسخة متسقة من قاعدة البيانات'
  $dataFile = Join-Path $tmp 'app.db'
  Push-Location $root
  node --no-warnings scripts/db-snapshot.mjs $dataFile
  $code = $LASTEXITCODE
  Pop-Location
  $LASTEXITCODE = $code; Check 'نسخ قاعدة البيانات'
  $dataName = 'app.db'
} else {
  $dataFile = "$root\data\people.json"; $dataName = 'people.json'
}

Write-Host '== ضغط الصور (قد يأخذ دقيقة)'
# tar المدمج في Windows (وليس tar الخاص بـ Git الذي يعامل C: كجهاز بعيد).
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
& $tar -czf (Join-Path $tmp 'storage.tgz') -C "$root\public\storage" .
Check 'ضغط الصور'

Write-Host '== الرفع (سيُطلب كلمة مرور السيرفر)'
ssh $Server 'mkdir -p /opt/beneficiaries-data/data /opt/beneficiaries-data/storage'; Check 'إنشاء المجلدات'
scp $dataFile "${Server}:/opt/beneficiaries-data/data/$dataName"; Check 'رفع البيانات'
scp (Join-Path $tmp 'storage.tgz') "${Server}:/opt/beneficiaries-data/storage.tgz"; Check 'رفع الصور'
ssh $Server 'cd /opt/beneficiaries-data && tar -xzf storage.tgz -C storage && rm storage.tgz && chown -R 1000:1000 /opt/beneficiaries-data && du -sh storage data'
Check 'فك الصور على السيرفر'

Remove-Item $tmp -Recurse -Force
Write-Host "تم رفع $dataName والصور. على السيرفر شغّل: sudo bash /opt/beneficiaries/deploy/server/setup.sh beneficiaries.den-op-ph.ly"
