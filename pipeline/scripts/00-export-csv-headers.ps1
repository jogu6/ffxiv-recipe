$pipelineRoot = Split-Path $PSScriptRoot -Parent
$inputFolder = Join-Path $pipelineRoot "input"
$outputFolder = Join-Path $pipelineRoot "reference\csv-headers"
New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null

$csvFiles = Get-ChildItem -Path (Join-Path $inputFolder "*.csv")

if ($csvFiles.Count -eq 0) {
    Write-Host "指定されたパスにCSVファイルが見つかりません。" -ForegroundColor Red
    return
}

foreach ($file in $csvFiles) {
    $outputName = "$($file.BaseName).txt"
    $outputPath = Join-Path -Path $outputFolder -ChildPath $outputName
    $header = Get-Content $file.FullName -TotalCount 1
    $columns = $header.Split(',')

    $indexedHeaders = for ($i = 0; $i -lt $columns.Count; $i++) {
        $i.ToString() + ": " + $columns[$i]
    }

    $indexedHeaders | Out-File -FilePath $outputPath -Encoding utf8
    Write-Host "作成完了: $outputName" -ForegroundColor Green
}
