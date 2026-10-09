# Meili HSK Study — who may sign in to the site. Run by the owner on his own computer: the password is typed
# here (hidden) and only its salted PBKDF2-SHA256 goes into access_users.json; then the change is committed and
# pushed, and Railway redeploys the site (about 2 minutes).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$file = Join-Path $repo 'access_users.json'
$git = 'C:\Users\finecompKZ\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$data = if (Test-Path $file) { Get-Content $file -Raw -Encoding utf8 | ConvertFrom-Json } else { [pscustomobject]@{ about = ''; users = @() } }
$users = @($data.users | Where-Object { $_ })

function Save-And-Push($message) {
    $data.users = $users
    [IO.File]::WriteAllText($file, ($data | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
    Push-Location $repo
    & $git add access_users.json
    & $git commit -q -m $message
    & $git push -q origin feature/forma-studio-publishing 2>&1 | Out-Null
    Pop-Location
    Write-Host "`nГотово. Сайт обновится примерно через 2 минуты." -ForegroundColor Green
}

Write-Host "Meili HSK Study — доступ к сайту`n" -ForegroundColor Cyan
if ($users.Count) { Write-Host ("Сейчас могут входить: " + (($users | ForEach-Object { $_.user }) -join ', ')) } else { Write-Host 'Пользователей пока нет — сайт открыт для всех.' }
Write-Host "`n1 — добавить пользователя или сменить пароль`n2 — удалить пользователя`n0 — выход"
$choice = Read-Host 'Выберите'
if ($choice -eq '1') {
    $name = (Read-Host 'Имя пользователя (латиницей, например asem)').Trim().ToLower()
    if (-not $name) { return }
    $p1 = Read-Host 'Пароль' -AsSecureString
    $p2 = Read-Host 'Пароль ещё раз' -AsSecureString
    $plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
    $a = & $plain $p1; $b = & $plain $p2
    if ($a -ne $b) { Write-Host 'Пароли не совпали, ничего не изменено.' -ForegroundColor Red; Read-Host 'Enter — закрыть'; return }
    if ($a.Length -lt 4) { Write-Host 'Слишком короткий пароль (нужно хотя бы 4 знака).' -ForegroundColor Red; Read-Host 'Enter — закрыть'; return }
    $salt = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
    $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes(([Text.Encoding]::UTF8.GetBytes($a)), $salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
    $hash = ($kdf.GetBytes(32) | ForEach-Object { $_.ToString('x2') }) -join ''
    $a = $null; $b = $null
    $users = @($users | Where-Object { $_.user -ne $name }) + [pscustomobject]@{ user = $name; salt = (($salt | ForEach-Object { $_.ToString('x2') }) -join ''); hash = $hash; iterations = 200000 }
    Save-And-Push "Site access: $name"
} elseif ($choice -eq '2') {
    $name = (Read-Host 'Кого удалить').Trim().ToLower()
    $users = @($users | Where-Object { $_.user -ne $name })
    Save-And-Push "Site access: remove $name"
}
Read-Host "`nEnter — закрыть"
