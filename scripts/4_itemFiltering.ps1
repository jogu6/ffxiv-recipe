function Filter-Items {
    param (
        [string]$inputJsonPath,
        [string]$outputPath
    )

    # 1. JSON読み込み
    if (!(Test-Path $inputJsonPath)) {
        Write-Error "JSONファイルが見つかりません: $inputJsonPath"
        return
    }
    $items = Get-Content $inputJsonPath -Raw | ConvertFrom-Json
    $totalCount = $items.Count
    
    Write-Host "アイテム総数: $totalCount" -ForegroundColor Cyan

    # 2. 全アイテムのIDセットと、レシピ材料として使われているIDセットを特定
    $usedInRecipeIds = New-Object System.Collections.Generic.HashSet[string]
    
    $i = 0
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    foreach ($item in $items) {
        $i++
        if (($null -ne $item.Recipe) -and ($null -ne $item.Recipe.Ingredients)) {
            foreach ($ing in $item.Recipe.Ingredients) {
                $ingId = [string]$ing.ItemID
                # 軍票（ID: "0"）などの特殊素材はハッシュセットへの登録をスキップする
                if ($ingId -ne "0" -and $ingId -ne "") {
                    [void]$usedInRecipeIds.Add($ingId)
                }
            }
        }
        
        # 進捗表示
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalCount) * 100)
            Write-Progress -Activity "材料IDをスキャン中" -Status "$i / $totalCount" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    Write-Progress -Activity "材料IDをスキャン中" -Completed

    # 3. フィルタリング処理
    $filteredItems = New-Object System.Collections.Generic.List[object]
    $i = 0
    $stopwatch.Restart()
    
    foreach ($item in $items) {
        $i++
        $itemId = [string]$item.ID
        
        # 条件チェック: 
        # ・RecipeプロパティがNullではない（軍票を消費して作るアイテム自体を残す）
        # ・または、IDが "0"（軍票そのもののレコードがあれば残す）
        # ・または、通常の材料として他で消費されている
        if (($null -ne $item.Recipe) -or $itemId -eq "0" -or $usedInRecipeIds.Contains($itemId)) {
            $filteredItems.Add($item)
        }

        # 進捗表示
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalCount) * 100)
            Write-Progress -Activity "アイテムをフィルタリング中" -Status "$i / $totalCount" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    Write-Progress -Activity "アイテムをフィルタリング中" -Completed
    $stopwatch.Stop()

    # 4. JSONとして書き出し
    $filteredItems | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding utf8
    
    # 5. 結果表示
    $removedCount = $totalCount - $filteredItems.Count
    Write-Host "--- 処理結果 ---" -ForegroundColor Cyan
    Write-Host "作成完了: $outputPath" -ForegroundColor Green
    Write-Host "残ったアイテム数: $($filteredItems.Count) 件" -ForegroundColor Yellow
    Write-Host "削除されたアイテム数: $removedCount 件" -ForegroundColor Red
}

# --- 実行処理 ---
$inputJson = "..\data\itemAndrecipe_addCat.json"
$outputJson = "..\data\itemAndRecipeFiltered.json"

Filter-Items -inputJsonPath $inputJson -outputPath $outputJson
