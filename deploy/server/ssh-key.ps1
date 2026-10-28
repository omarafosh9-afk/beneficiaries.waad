# مرة واحدة فقط: يجعل السيرفر يعرف جهازك فلا يطلب كلمة مروره بعد ذلك.
#   .\deploy\server\ssh-key.ps1
# إن سُئلت عن passphrase اضغط Enter مرتين. ستُطلب كلمة مرور السيرفر هذه المرة الأخيرة.
param([string]$Server = 'root@102.203.201.227')
$ErrorActionPreference = 'Stop'

$key = Join-Path $HOME '.ssh\id_ed25519'
if (-not (Test-Path $key)) {
  New-Item -ItemType Directory -Force (Split-Path $key) | Out-Null
  ssh-keygen -t ed25519 -f $key
  if ($LASTEXITCODE -ne 0) { throw 'فشل إنشاء المفتاح' }
}
Get-Content "$key.pub" | ssh $Server 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
if ($LASTEXITCODE -ne 0) { throw 'فشل نسخ المفتاح إلى السيرفر' }
Write-Host 'تم. جرّب: ssh' $Server '— يجب أن يدخل دون كلمة مرور.' -ForegroundColor Green
