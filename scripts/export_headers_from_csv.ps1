# ../data フォルダ内の全CSVファイルを対象に処理
$csvFiles = Get-ChildItem -Path "..\data\*.csv"

if ($csvFiles.Count -eq 0) {
    Write-Host "指定されたパスにCSVファイルが見つかりません。" -ForegroundColor Red
    return
}

foreach ($file in $csvFiles) {
    # 出力ファイル名を作成
    $outputName = "$($file.BaseName)_csv_header.txt"
    $outputPath = Join-Path -Path $file.DirectoryName -ChildPath $outputName

    # 1行目（ヘッダー）を読み込み
    $header = Get-Content $file.FullName -TotalCount 1
    $columns = $header.Split(',')
    
    # 0から始まる番号付きでリスト化（文字列連結で解決）
    $indexedHeaders = for ($i = 0; $i -lt $columns.Count; $i++) {
        $i.ToString() + ": " + $columns[$i]
    }

    # ファイルに書き出し
    $indexedHeaders | Out-File -FilePath $outputPath -Encoding utf8

    Write-Host "作成完了: $outputName" -ForegroundColor Green
}