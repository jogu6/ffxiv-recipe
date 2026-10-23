#requires -Version 7.4
param([Parameter(Mandatory)][string]$RulesFile)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows required' }
$workerRoot = 'C:\BuildWorker-Production'
Import-Module C:\BuildWorker-Production\windows\Worker.psm1
$source = [IO.Path]::GetFullPath((Get-Location).ProviderPath)
if ($source -notmatch '^C:\\BuildWorker-Production\\data\\jobs\\[0-9a-f-]{36}\\[0-9]+\\source$') { throw 'Job source required' }
[BuildWorker.Paths]::NoLinks($source)
$rulesPath = [IO.Path]::GetFullPath($RulesFile)
if (-not $rulesPath.StartsWith('C:\BuildWorker-Production\deployment\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Local rules required' }
[BuildWorker.Paths]::NoLinks($rulesPath)
$text = [IO.File]::ReadAllText($rulesPath)
[void][BuildWorker.Guard]::Json($text)
$rules = ConvertFrom-Json -InputObject $text -AsHashtable
foreach ($rule in $rules) {
    $buildRoot = if ($rule.root -ceq 'source') { $source } elseif ($rule.root -ceq 'target') { $env:CARGO_TARGET_DIR } else { throw 'Unapproved build root' }
    if ($rule.root -ceq 'target' -and $buildRoot -ine ([IO.Path]::Combine([IO.Path]::GetDirectoryName($source), 'target'))) { throw 'Unexpected target path' }
    $from = [BuildWorker.Paths]::Inside($buildRoot, $rule.from)
    if ($rule.kind -ceq 'single-exe-directory') {
        [BuildWorker.Paths]::NoLinks($from)
        $matches = @(Get-ChildItem -LiteralPath $from -File | Where-Object { $_.Extension -ieq '.exe' })
        if ($matches.Count -ne 1) { throw 'Exactly one installer is required; refusing to guess' }
        $from = $matches[0].FullName
    } elseif ($rule.kind -cne 'file') { throw 'Unknown artifact rule' }
    [BuildWorker.Paths]::NoLinks($from)
    $destination = [BuildWorker.Paths]::Inside($source, $rule.to)
    [BuildWorker.Paths]::CopyBounded($from, $destination, ([IO.FileInfo]$from).Length)
}
