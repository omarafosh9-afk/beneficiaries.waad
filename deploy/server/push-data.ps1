# يُشغَّل على جهازك (Windows) لرفع البيانات والصور إلى السيرفر:
#   .\deploy\server\push-data.ps1 -Server root@102.203.201.227
# يرفع: قاعدة البيانات الحالية (data\app.db، بكل التصحيحات) ومجلد الصور public\storage
# إلى /opt/beneficiaries-data. إن لم توجد القاعدة يرفع data\people.json بدلها.
param([Parameter(Mandatory = $true)][string]$Server)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\..\.."
$tmp = Join-Path $env:TEMP 'beneficiaries-upload'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

if (Test-Path "$root\data\app.db") {
  Write-Host '== نسخة متسقة من قاعدة البيانات'
  $dbCopy = Join-Path $tmp 'app.db'
  Push-Location $root
  node --no-warnings --input-type=module -e "const {openDb}=await import('./lib/db-node.js');const db=openDb();db.exec(`"VACUUM INTO '$($dbCopy -replace '\\','/')'`");db.close();"
  Pop-Location
  $dataFile = $dbCopy; $dataName = 'app.db'
} else {
  $dataFile = "$root\data\people.json"; $dataName = 'people.json'
}

Write-Host '== ضغط الصور (قد يأخذ دقيقة)'
tar -czf "$tmp\storage.tgz" -C "$root\public\storage" .

Write-Host '== الرفع'
ssh $Server 'mkdir -p /opt/beneficiaries-data/data /opt/beneficiaries-data/storage'
scp $dataFile "${Server}:/opt/beneficiaries-data/data/$dataName"
scp "$tmp\storage.tgz" "${Server}:/opt/beneficiaries-data/storage.tgz"
ssh $Server 'cd /opt/beneficiaries-data && tar -xzf storage.tgz -C storage && rm storage.tgz && chown -R 1000:1000 /opt/beneficiaries-data && du -sh storage data'

Remove-Item $tmp -Recurse -Force
Write-Host "تم رفع $dataName والصور. على السيرفر شغّل: sudo bash /opt/beneficiaries/deploy/server/setup.sh beneficiaries.den-op-ph.ly"
