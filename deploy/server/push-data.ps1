# يُشغَّل على جهازك (Windows) لرفع البيانات والصور إلى السيرفر مرة واحدة:
#   .\deploy\server\push-data.ps1 -Server root@IP_السيرفر
# يرفع: data\people.json ومجلد الصور public\storage إلى /opt/beneficiaries-data
param([Parameter(Mandatory = $true)][string]$Server)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\..\.."
$tmp = Join-Path $env:TEMP 'beneficiaries-upload'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null

Write-Host '== ضغط الصور (قد يأخذ دقيقة)'
tar -czf "$tmp\storage.tgz" -C "$root\public\storage" .
Copy-Item "$root\data\people.json" "$tmp\people.json"

Write-Host '== الرفع'
ssh $Server 'mkdir -p /opt/beneficiaries-data/data /opt/beneficiaries-data/storage'
scp "$tmp\people.json" "${Server}:/opt/beneficiaries-data/data/people.json"
scp "$tmp\storage.tgz" "${Server}:/opt/beneficiaries-data/storage.tgz"
ssh $Server 'cd /opt/beneficiaries-data && tar -xzf storage.tgz -C storage && rm storage.tgz && chown -R 1000:1000 /opt/beneficiaries-data && du -sh storage data'

Remove-Item $tmp -Recurse -Force
Write-Host 'تم رفع البيانات. على السيرفر شغّل: sudo bash deploy/server/setup.sh beneficiaries.alwaha-care.ly'
