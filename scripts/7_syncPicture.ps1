# スクリプトの場所から見て、親フォルダにある picture フォルダを定義
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootPath = Split-Path $scriptDir -Parent
$pictureDir = Join-Path $rootPath "picture"

Write-Host "--- pictureフォルダーのみの同期を開始します ---" -ForegroundColor Cyan

# ルートディレクトリへ移動
Push-Location $rootPath

# 1. バッファ設定
git config --local http.postBuffer 524288000

# 2. 【重要】pictureフォルダのみを明示的にステージング
# "." ではなく "$pictureDir" を指定することで他を無視します
git add $pictureDir

# 3. コミット（pictureに関連するものだけ）
git commit -m "Update icon images in picture folder"

# 4. プッシュ前にリモートの差分を吸収（fetch/merge）
# エラーを回避するため、まずはリモートの変更を取り込みます
git pull origin main --allow-unrelated-histories --no-rebase

# 5. プッシュ
Write-Host "GitHubへプッシュ中..." -ForegroundColor Yellow
git push origin main --progress

if ($LASTEXITCODE -eq 0) {
    Write-Host "同期が完了しました。" -ForegroundColor Green
} else {
    Write-Host "プッシュに失敗しました。" -ForegroundColor Red
}

Pop-Location