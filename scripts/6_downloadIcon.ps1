function Download-Icons {
    param (
        [string]$jsonPath,
        [string]$outputFolder
    )

    # pictureフォルダーの確認・作成
    if (!(Test-Path $outputFolder)) { New-Item -ItemType Directory -Path $outputFolder | Out-Null }
    
    # logフォルダーの確認・作成
    $logFolder = Join-Path (Split-Path $outputFolder -Parent) "log"
    if (!(Test-Path $logFolder)) { New-Item -ItemType Directory -Path $logFolder | Out-Null }
    
    $errLog = Join-Path $logFolder "err_download.txt"
    "" | Out-File -FilePath $errLog -Encoding utf8

    $items = Get-Content $jsonPath -Raw | ConvertFrom-Json
    $totalCount = $items.Count
    $successCount = $skipCount = $errorCount = $i = 0
    
    # 計測用ストップウォッチ
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $totalTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $client = [System.Net.Http.HttpClient]::new()

    foreach ($item in $items) {
        $i++
        $fileName = [string]$item.IconFile
        if ([string]::IsNullOrWhiteSpace($fileName)) { continue }

        $iconId = 0
        if (![int]::TryParse([System.IO.Path]::GetFileNameWithoutExtension($fileName), [ref]$iconId)) {
            $fileName | Out-File -FilePath $errLog -Append -Encoding utf8
            $errorCount++
            continue
        }

        $folderId = [int]([Math]::Floor($iconId / 1000) * 1000)
        $url = "https://xivapi.com/i/" + $folderId.ToString("D6") + "/" + $fileName
        $outputPath = Join-Path $outputFolder $fileName

        if (Test-Path $outputPath) {
            $skipCount++
        } else {
            try {
                Start-Sleep -Milliseconds 200
                $response = $client.GetAsync($url).Result
                if ($response.IsSuccessStatusCode) {
                    $bytes = $response.Content.ReadAsByteArrayAsync().Result
                    [System.IO.File]::WriteAllBytes($outputPath, $bytes)
                    $successCount++
                } else {
                    $url | Out-File -FilePath $errLog -Append -Encoding utf8
                    $errorCount++
                }
            } catch {
                $url | Out-File -FilePath $errLog -Append -Encoding utf8
                $errorCount++
            }
        }

        # 1秒ごとに更新
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalCount) * 100)
            
            # 平均速度と残り時間の計算
            $elapsedSeconds = $totalTimer.Elapsed.TotalSeconds
            $avgSecondsPerItem = $elapsedSeconds / $i
            $etaSeconds = [int](($totalCount - $i) * $avgSecondsPerItem)
            
            $ts = [timespan]::FromSeconds($etaSeconds)
            $etaString = "$($ts.Hours)h $($ts.Minutes)m $($ts.Seconds)s"
            
            # Status行にETAを表示
            Write-Progress -Activity "Downloading Icons" `
                           -Status "進捗: $i / $totalCount ($percent%)  ETA: $etaString" `
                           -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    $client.Dispose()
    $totalTimer.Stop()
    Write-Progress -Activity "Downloading Icons" -Completed

    Write-Host "成功: $successCount, スキップ: $skipCount, 失敗: $errorCount" -ForegroundColor Cyan
    Write-Host "エラーログ出力先: $errLog" -ForegroundColor Yellow
}

$itemJson = "..\data\item.json"
$pictureFolder = "..\picture"
Download-Icons -jsonPath $itemJson -outputFolder $pictureFolder
