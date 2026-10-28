# رفع تعديلات البرنامج إلى السيرفر بأمر واحد (البيانات على السيرفر لا تُمس):
#   .\deploy\server\update.ps1
# يرفع الفرع الحالي إلى GitHub، ثم يسحبه السيرفر ويعيد البناء والتشغيل.
param([string]$Server = 'root@102.203.201.227')
$ErrorActionPreference = 'Stop'

function Check($what) {
  if ($LASTEXITCODE -ne 0) { throw "فشل: $what (رمز $LASTEXITCODE)" }
}

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$branch = (git -C $root rev-parse --abbrev-ref HEAD).Trim()
if (git -C $root status --porcelain --untracked-files=no) {
  Write-Host 'تنبيه: توجد تعديلات غير محفوظة (commit) ولن تُرفع.' -ForegroundColor Yellow
}

Write-Host "== رفع الفرع $branch إلى GitHub"
git -C $root push -q origin $branch; Check 'الرفع إلى GitHub'

Write-Host '== التحديث على السيرفر (دقيقة أو اثنتان)'
ssh $Server "bash /opt/beneficiaries/deploy/server/update.sh $branch"; Check 'التحديث على السيرفر'

Write-Host 'تم. حدّث الصفحة في المتصفح (Ctrl+F5).' -ForegroundColor Green
