function Merge-ItemSearchCategory {
    param (
        [string]$inputJsonPath,
        [string]$csvPath,
        [string]$outputPath
    )

    # 1. ItemSearchCategory.csv を解析し、IDをキーとしたハッシュテーブルを作成
    $searchCatDict = @{}
    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($csvPath)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true
    
    [void]$parser.ReadFields() # ヘッダー読み飛ばし
    while (!$parser.EndOfData) {
        $data = $parser.ReadFields()
        $searchCatDict[$data[0]] = $data[1] # ID(0) をキーに Name(1) を保存
    }
    $parser.Close()

    # 2. 既存の JSON を読み込む
    $items = Get-Content $inputJsonPath -Raw | ConvertFrom-Json
    $totalLines = $items.Count
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $i = 0
    $matchCount = 0
    $skipCount = 0

    # 3. カテゴリ名をマッピング
    foreach ($item in $items) {
        $i++
        $catId = [string]$item.ItemSearchCategory
        
        if ($searchCatDict.ContainsKey($catId)) {
            $item | Add-Member -MemberType NoteProperty -Name "ItemSearchCategoryName" -Value $searchCatDict[$catId] -Force
            $matchCount++
        } else {
            $skipCount++
        }

        # 1秒ごとに進捗更新
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalLines) * 100)
            Write-Progress -Activity "Merging Search Category" -Status "$i / $totalLines" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    
    Write-Progress -Activity "Merging Search Category" -Completed
    $stopwatch.Stop()

    # 4. JSONとして書き出し
    $items | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding utf8
    
    Write-Host "作成完了: $outputPath" -ForegroundColor Green
    Write-Host "カテゴリ名称付与数: $matchCount 件" -ForegroundColor Green
    Write-Host "付与スキップ数: $skipCount 件" -ForegroundColor Yellow
}

# --- 実行処理 ---
$inputJson = "..\data\itemAndRecipeFiltered.json"
$searchCatCsv = "..\data\ItemSearchCategory.csv"
$outputJson = "..\data\item.json" # 指定通り item.json として出力

Merge-ItemSearchCategory -inputJsonPath $inputJson -csvPath $searchCatCsv -outputPath $outputJson