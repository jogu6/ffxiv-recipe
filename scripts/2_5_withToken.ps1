function Add-TokenRecipeToItem {
    param (
        [string]$itemJsonPath,
        [string]$tokenCsvPath,
        [string]$outputPath
    )

    # 1. 既存の json を読み込み
    if (!(Test-Path $itemJsonPath)) {
        Write-Error "JSONファイルが見つかりません: $itemJsonPath"
        return
    }
    $itemData = Get-Content $itemJsonPath -Raw | ConvertFrom-Json

    # 紐付け高速化とID/名前検索用のハッシュテーブル構築
    $itemDict = @{}       # アイテム名 -> アイテムオブジェクト
    $nameToIdDict = @{}   # アイテム名 -> アイテムID

    foreach ($item in $itemData) {
        $itemDict[[string]$item.Name] = $item
        $nameToIdDict[[string]$item.Name] = [string]$item.ID
    }

    # 2. CSVを解析 (ヘッダーなし、1列目:アイテム名, 2列目:トークン名, 3列目:必要数, 4列目:CraftType)
    if (!(Test-Path $tokenCsvPath)) {
        Write-Error "CSVファイルが見つかりません: $tokenCsvPath"
        return
    }

    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($tokenCsvPath)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true
    
    # 全行数の取得（プログレスバー用、ヘッダーなしのためCountそのまま）
    $totalLines = (Get-Content $tokenCsvPath).Count
    if ($totalLines -le 0) { $totalLines = 1 }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $i = 0
    $matchCount = 0
    $skipCount = 0

    while (!$parser.EndOfData) {
        $data = $parser.ReadFields()
        $i++

        # 列データのマッピング
        $targetItemName = [string]$data[0]
        $tokenItemName  = [string]$data[1]
        $amount         = [string]$data[2]
        $craftType      = [string]$data[3]

        if ($data.Count -ne 4 -or $craftType -notin @("8", "9")) {
            throw "CSVの形式が不正です ($i 行目): CraftTypeには8または9を指定してください。"
        }

        # 対象アイテム名が元のJSONに存在するかチェック
        if ($itemDict.ContainsKey($targetItemName)) {
            $item = $itemDict[$targetItemName]

            # トークンのItemIDを特定する
            $tokenId = "0"
            if ($tokenItemName -eq "軍票") {
                $tokenId = "0"
            } elseif ($nameToIdDict.ContainsKey($tokenItemName)) {
                $tokenId = $nameToIdDict[$tokenItemName]
            } else {
                # 軍票以外で万が一見つからない場合のセーフティ（0として扱う）
                $tokenId = "0"
            }

            # 新規のイングリディエント要素を作成
            $newIngredient = [PSCustomObject]@{
                ItemID = $tokenId
                Name   = $tokenItemName
                Amount = $amount
            }

            # 対象アイテムに既に Recipe キーが存在するか判定
            if ($null -ne $item.Recipe) {
                # 既存のRecipe内のIngredients配列に追記
                if ($null -eq $item.Recipe.Ingredients) {
                    # Ingredientsが未定義またはNullだった場合の初期化
                    $item.Recipe.Ingredients = @($newIngredient)
                } else {
                    # 既存の配列に追加
                    $item.Recipe.Ingredients = @($item.Recipe.Ingredients) + $newIngredient
                }
            } else {
                # Recipeキーが存在しないため、指定された固定値と構造で新規作成
                $recipeObj = [PSCustomObject]@{
                    CraftType    = $craftType
                    AmountResult = "1"
                    Ingredients  = @($newIngredient)
                }
                # アイテムオブジェクトに Recipe プロパティを追加
                $item | Add-Member -MemberType NoteProperty -Name "Recipe" -Value $recipeObj -Force
            }

            $matchCount++
        } else {
            $skipCount++
        }

        # 1秒ごとにプログレスバーを更新
        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalLines) * 100)
            Write-Progress -Activity "Adding Token Recipes" -Status "$i / $totalLines" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    $parser.Close()
    $stopwatch.Stop()
    
    # 進捗バーの完了表示
    Write-Progress -Activity "Adding Token Recipes" -Status "Complete" -PercentComplete 100
    Write-Progress -Activity "Adding Token Recipes" -Completed
    
    # 3. 統合されたデータの書き込み処理
    $itemData | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding utf8
    
    # 終了時のステータス表示
    Write-Host "作成完了: $outputPath" -ForegroundColor Green
    Write-Host "レシピ追記・作成数: $matchCount 件" -ForegroundColor Green
    Write-Host "対象アイテム不在スキップ数: $skipCount 件" -ForegroundColor Yellow
}

# --- 実行処理 ---
$itemJson  = "..\data\itemAndrecipe.json"
$tokenCsv  = "..\data\tokenItem_original.csv"
$outputJson = "..\data\itemAndrecipe_updated.json"

# 関数呼び出し
Add-TokenRecipeToItem -itemJsonPath $itemJson -tokenCsvPath $tokenCsv -outputPath $outputJson
