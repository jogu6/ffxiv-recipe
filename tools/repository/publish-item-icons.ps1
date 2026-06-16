$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$iconDirectory = Join-Path $repositoryRoot 'site\assets\item-icons'

Push-Location $repositoryRoot
try {
    git add -- $iconDirectory
    git diff --cached --quiet -- $iconDirectory
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'アイテム画像に変更はありません。' -ForegroundColor Yellow
        return
    }

    git commit -m 'Update item icons'
    if ($LASTEXITCODE -ne 0) { throw 'コミットに失敗しました。' }

    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) { throw 'リモート変更の取り込みに失敗しました。' }

    git push origin main --progress
    if ($LASTEXITCODE -ne 0) { throw 'プッシュに失敗しました。' }

    Write-Host 'アイテム画像の同期が完了しました。' -ForegroundColor Green
} finally {
    Pop-Location
}
