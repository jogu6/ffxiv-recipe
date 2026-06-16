# PowerShellアップデートおよび設定案内用スクリプト
Write-Host "PowerShellを最新版にアップデートします..." -ForegroundColor Cyan

# wingetを使用してMicrosoft.PowerShellをインストール/アップデート
winget install --id Microsoft.PowerShell --source winget --accept-package-agreements --accept-source-agreements

Write-Host "アップデート処理が完了しました。" -ForegroundColor Green
Write-Host "--------------------------------------------------------" -ForegroundColor Yellow
Write-Host "【重要】今後のターミナル設定について" -ForegroundColor Yellow
Write-Host "次回から最新のPowerShell (pwsh) を自動起動するには、" -ForegroundColor Yellow
Write-Host "Windows Terminalの設定で以下を変更してください。" -ForegroundColor Yellow
Write-Host "1. Windows Terminalを開き、上部メニューの「∨」から「設定」を選択。" -ForegroundColor Yellow
Write-Host "2. 左側メニューの「既定値」を選択。" -ForegroundColor Yellow
Write-Host "3. 「既定のプロファイル」で「PowerShell」を選択して「保存」をクリック。" -ForegroundColor Yellow
Write-Host "--------------------------------------------------------" -ForegroundColor Yellow