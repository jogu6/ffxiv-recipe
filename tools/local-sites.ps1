param(
    [ValidateSet("Start", "Stop", "Status")]
    [string]$Action = "Start"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$aboutRoot = Join-Path (Split-Path -Parent $projectRoot) "ff14-recipe-about"
$statePath = Join-Path ([System.IO.Path]::GetTempPath()) "ffxiv-recipe-local-sites.json"

function Read-State {
    if (-not (Test-Path -LiteralPath $statePath)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Get-LiveProcesses {
    $state = Read-State
    if ($null -eq $state) {
        return @()
    }
    return @($state.processes | ForEach-Object {
        $entry = $_
        $process = Get-Process -Id ([int]$entry.id) -ErrorAction SilentlyContinue
        if ($null -eq $process -or $null -eq $entry.startTimeUtcTicks -or $null -eq $entry.executablePath) {
            return
        }
        try {
            $startMatches = $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) -eq
                [string]$entry.startTimeUtcTicks
            $pathMatches = [StringComparer]::OrdinalIgnoreCase.Equals(
                [System.IO.Path]::GetFullPath($process.Path),
                [System.IO.Path]::GetFullPath([string]$entry.executablePath)
            )
            if ($startMatches -and $pathMatches) {
                $process
            }
        } catch {
            return
        }
    })
}

function Stop-LocalSites {
    param([switch]$Quiet)

    $processes = Get-LiveProcesses
    foreach ($process in $processes) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    if (-not $Quiet) {
        if ($processes.Count -gt 0) {
            Write-Host "4173・4174のローカルサーバーを停止しました。"
        } else {
            Write-Host "停止対象のローカルサーバーはありません。"
        }
    }
}

if ($Action -eq "Stop") {
    Stop-LocalSites
    exit 0
}

$liveProcesses = Get-LiveProcesses
if ($Action -eq "Status") {
    if ($liveProcesses.Count -eq 0) {
        Write-Host "ローカルサーバーは停止しています。"
    } else {
        Write-Host "ローカルサーバーは起動中です: $($liveProcesses.Id -join ', ')"
    }
    exit 0
}

if ($liveProcesses.Count -gt 0) {
    throw "ローカルサーバーはすでに起動しています。停止するには -Action Stop を指定してください。"
}
if (-not (Test-Path -LiteralPath $aboutRoot)) {
    throw "ff14-recipe-about が見つかりません: $aboutRoot"
}
if (Get-NetTCPConnection -State Listen -LocalPort 4173, 4174 -ErrorAction SilentlyContinue) {
    throw "4173または4174番ポートがすでに使用されています。"
}

$pythonPath = (& py -c "import sys; print(sys.executable)").Trim()
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python実行ファイルが見つかりません。"
}

$app = Start-Process -FilePath $pythonPath -ArgumentList @(
    "tools/serve-local-app.py", "--port", "4173", "--bind", "0.0.0.0", "--directory", "site"
) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
try {
    $about = Start-Process -FilePath "node.exe" -ArgumentList @(
        "tools/serve-site.mjs", "--port", "4174", "--bind", "0.0.0.0"
    ) -WorkingDirectory $aboutRoot -WindowStyle Hidden -PassThru
} catch {
    Stop-Process -Id $app.Id -ErrorAction SilentlyContinue
    throw
}

@{
    processes = @(
        @{
            id = $app.Id
            name = "ffxiv-recipe"
            port = 4173
            executablePath = $app.Path
            startTimeUtcTicks = $app.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
        },
        @{
            id = $about.Id
            name = "ff14-recipe-about"
            port = 4174
            executablePath = $about.Path
            startTimeUtcTicks = $about.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
        }
    )
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host "Webアプリ: http://127.0.0.1:4173/"
Write-Host "使い方ガイド・広場: http://127.0.0.1:4174/"
Write-Host "LAN Webアプリ: http://192.168.11.2:4173/"
Write-Host "LAN 使い方ガイド・広場: http://192.168.11.2:4174/"
Write-Host "Ctrl+Cで両方停止します。"

try {
    while (-not $app.HasExited -and -not $about.HasExited) {
        Start-Sleep -Seconds 1
        $app.Refresh()
        $about.Refresh()
    }
    if (-not (Test-Path -LiteralPath $statePath)) {
        return
    }
    if ($app.HasExited) {
        throw "Webアプリのローカルサーバーが終了しました。終了コード: $($app.ExitCode)"
    }
    throw "使い方ガイドのローカルサーバーが終了しました。終了コード: $($about.ExitCode)"
} finally {
    Stop-LocalSites -Quiet
}
