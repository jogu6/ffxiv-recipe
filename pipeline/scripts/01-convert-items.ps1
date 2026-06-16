# 関数定義：CSVをJSONに変換する汎用処理
function ConvertTo-JsonData {
    param (
        [string]$csvPath,
        [string]$jsonPath,
        [scriptblock]$MappingScript
    )

    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($csvPath)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true

    $totalLines = (Get-Content $csvPath).Count - 1
    $processedItems = New-Object System.Collections.Generic.List[PSObject]
    
    $skipCount = 0
    $successCount = 0

    [void]$parser.ReadFields() # ヘッダー読み飛ばし

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $i = 0
    
    while (!$parser.EndOfData) {
        $data = $parser.ReadFields()
        
        # Name（$data[4]）が空文字ならスキップ
        if ($data[4] -eq "") {
            $skipCount++
        } else {
            # マッピング処理を実行
            $obj = &$MappingScript $data
            [void]$processedItems.Add($obj)
            $successCount++
        }
        
        $i++
        
        # 1秒ごとに進捗更新
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalLines) * 100)
            Write-Progress -Activity "Converting $csvPath" -Status "$i / $totalLines" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    $parser.Close()
    $stopwatch.Stop()

    Write-Progress -Activity "Converting $csvPath" -Status "Complete" -PercentComplete 100
    Write-Progress -Activity "Converting $csvPath" -Completed

    $processedItems | ConvertTo-Json -Depth 1 | Out-File -FilePath $jsonPath -Encoding utf8
    
    Write-Host "作成完了: $jsonPath" -ForegroundColor Green
    Write-Host "総登録数: $successCount 件" -ForegroundColor Green
    Write-Host "スキップ数: $skipCount 件" -ForegroundColor Yellow
}

# --- 実行処理 ---

$pipelineRoot = Split-Path $PSScriptRoot -Parent
$csvPath = Join-Path $pipelineRoot "input\Item.csv"
$jsonPath = Join-Path $pipelineRoot "intermediate\items-base.json"

# アイテムデータ用マッピング
$itemMapping = {
    param($data)
    
    $iconId = 0
    [int]::TryParse($data[68], [ref]$iconId) | Out-Null
    $iconFile = $iconId.ToString("D6") + ".png"

    [PSCustomObject]@{
        ID                  = $data[0]
        Name                = $data[4]
        Description         = $data[3]
        LevelEquip          = $data[32]
        ItemUICategory      = $data[77]
        ItemSearchCategory  = $data[78]
        IconFile            = $iconFile
    }
}

# 関数呼び出し
ConvertTo-JsonData -csvPath $csvPath -jsonPath $jsonPath -MappingScript $itemMapping
