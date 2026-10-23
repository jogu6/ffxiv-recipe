@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Provision private control directories before using this launcher. No tasks are registered.
if not exist "C:\BuildWorker-Production\control\compiler-temp" exit /b 2
if not exist "C:\Program Files\PowerShell\7\pwsh.exe" exit /b 2
set "TEMP=C:\BuildWorker-Production\control\compiler-temp"
set "TMP=C:\BuildWorker-Production\control\compiler-temp"
set "PSModuleAnalysisCachePath=C:\BuildWorker-Production\control\ModuleAnalysisCache"
set "POWERSHELL_TELEMETRY_OPTOUT=1"
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
set "DOTNET_CLI_HOME=C:\BuildWorker-Production\control\dotnet"
"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -NonInteractive -File "C:\BuildWorker-Production\windows\Worker.ps1" -Mode Run
exit /b %errorlevel%
