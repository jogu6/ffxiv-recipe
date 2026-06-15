# 関数定義：CSVとJSONを統合変換する処理
function Merge-ItemAndRecipe {
    param (
        [string]$itemJsonPath,
        [string]$recipeCsvPath,
        [string]$outputPath
    )

    # 1. 既存の item.json を読み込み、IDをキーにしたハッシュテーブルを作成
    $itemData = Get-Content $itemJsonPath -Raw | ConvertFrom-Json
    $itemDict = @{}
    # 名前検索用ハッシュテーブル
    $idToName = @{}
    
    foreach ($item in $itemData) {
        $itemDict[[string]$item.ID] = $item
        $idToName[[string]$item.ID] = $item.Name
    }

    # 2. Recipe.csv を解析
    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($recipeCsvPath)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true
    
    $totalLines = (Get-Content $recipeCsvPath).Count - 1
    [void]$parser.ReadFields() # ヘッダー読み飛ばし

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $i = 0
    $skipCount = 0
    $matchCount = 0

    while (!$parser.EndOfData) {
        $data = $parser.ReadFields()
        $i++

        $itemId = [string]$data[5] # ItemResult
        if ($itemDict.ContainsKey($itemId)) {
            $recipeObj = [PSCustomObject]@{
                CraftType          = $data[4]
                PatchNumber        = $data[29]
                AmountResult       = $data[30]
                Ingredients        = @(
                    for ($j = 0; $j -lt 8; $j++) {
                        $ingId = [string]$data[6 + $j]
                        # 既存のID検索用辞書に存在する場合のみ追加（存在しない場合はスキップ）
                        if ($ingId -ne "0" -and $idToName.ContainsKey($ingId)) {
                            [PSCustomObject]@{ ItemID = $ingId; Name = $idToName[$ingId]; Amount = $data[31 + $j] }
                        }
                    }
                )
            }
            
            $itemDict[$itemId] | Add-Member -MemberType NoteProperty -Name "Recipe" -Value $recipeObj -Force
            $matchCount++
        } else {
            $skipCount++
        }

        if ($stopwatch.ElapsedMilliseconds -gt 1000) {
            $percent = [int](($i / $totalLines) * 100)
            Write-Progress -Activity "Merging Recipe Data" -Status "$i / $totalLines" -PercentComplete $percent
            $stopwatch.Restart()
        }
    }
    $parser.Close()
    
    Write-Progress -Activity "Merging Recipe Data" -Completed
    
    $itemData | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding utf8
    
    Write-Host "作成完了: $outputPath" -ForegroundColor Green
    Write-Host "レシピ紐付け数: $matchCount 件" -ForegroundColor Green
    Write-Host "紐付けスキップ数: $skipCount 件" -ForegroundColor Yellow
}

# --- 実行処理 ---
$itemJson = "..\data\Item.json"
$recipeCsv = "..\data\Recipe.csv"
$outputJson = "..\data\itemAndrecipe.json"

Merge-ItemAndRecipe -itemJsonPath $itemJson -recipeCsvPath $recipeCsv -outputPath $outputJson
