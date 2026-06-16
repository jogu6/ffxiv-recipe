$ErrorActionPreference = 'Stop'

$steps = @(
    '01-convert-items.ps1',
    '02-add-recipes.ps1',
    '03-add-token-recipes.ps1',
    '04-add-ui-categories.ps1',
    '05-filter-items.ps1',
    '06-build-public-data.ps1'
)

foreach ($step in $steps) {
    $scriptPath = Join-Path $PSScriptRoot $step
    Write-Host "--- $step ---" -ForegroundColor Cyan
    & $scriptPath
}

Write-Host '公開データの生成が完了しました。' -ForegroundColor Green
