#requires -Version 7.4
param([string]$CodeRoot)
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath (Join-Path $CodeRoot 'deployment') -Filter '*.ps1' -File) + @(Get-ChildItem -LiteralPath (Join-Path $CodeRoot 'windows') -File | Where-Object { $_.Extension -in @('.ps1', '.psm1') }) + @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File)
foreach ($file in $files) {
    $tokens = $null; $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw ('PowerShell AST error in ' + $file.Name) }
}
Import-Module (Join-Path $CodeRoot 'windows/Worker.psm1') -Force
Write-Output ('STATIC PowerShell AST files=' + $files.Count + '; C# types compiled successfully')
