function Add-CategoryNameToItems {
    param (
        [string]$inputJsonPath,
        [string]$categoryCsvPath,
        [string]$outputPath
    )

    # 1. ItemUICategory.csv を読み込み、IDをキーにした名前用ハッシュテーブルを作成
    $catDict = @{}
    $catParser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($categoryCsvPath)
    $catParser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $catParser.SetDelimiters(',')
    $catParser.HasFieldsEnclosedInQuotes = $true
    
    [void]$catParser.ReadFields() # ヘッダー読み飛ばし
    while (!$catParser.EndOfData) {
        $fields = $catParser.ReadFields()
        $catDict[$fields[0]] = $fields[1] # IDをキーにNameを保存
    }
    $catParser.Close()

    # 2. itemAndrecipeOnly.json を読み込み
    $items = Get-Content $inputJsonPath -Raw | ConvertFrom-Json
    $totalCount = $items.Count
    
    $successCount = 0
    $i = 0
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    # 3. カテゴリ名称を付与
    foreach ($item in $items) {
        $i++
        
        # アイテムのItemUICategory（ID）に対応する名称を検索
        $catId = [string]$item.ItemUICategory
        if ($catDict.ContainsKey($catId)) {
            $item | Add-Member -MemberType NoteProperty -Name "ItemUICategoryName" -Value $catDict[$catId] -Force
            $successCount++
        }

        # 1秒ごとに進捗更新
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalCount) * 100)
            Write-Progress -Activity "Adding Category Names" -Status "$i / $totalCount" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    
    Write-Progress -Activity "Adding Category Names" -Completed
    $stopwatch.Stop()

    # 4. JSONとして書き出し
    $items | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding utf8
    
    Write-Host "作成完了: $outputPath" -ForegroundColor Green
    Write-Host "カテゴリ付与数: $successCount 件" -ForegroundColor Green
}

# --- 実行処理 ---
$inputJson = "..\data\itemAndrecipe_updated.json"
$catCsv = "..\data\ItemUICategory.csv"
$outputJson = "..\data\itemAndrecipe_addCat.json"

Add-CategoryNameToItems -inputJsonPath $inputJson -categoryCsvPath $catCsv -outputPath $outputJson