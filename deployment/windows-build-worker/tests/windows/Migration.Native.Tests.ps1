#requires -Version 7.4
param([string]$FixtureRoot, [string]$CodeRoot, [ValidateSet('Lifecycle','Rejection')][string]$CaseName)
$ErrorActionPreference='Stop'
if (-not $IsWindows) {throw 'Windows native ACL test only'}
. (Join-Path $CodeRoot 'deployment/Migrate-WindowsAcl.ps1')
function Check($ok) {if (-not $ok) {throw 'Native migration assertion failed'}}
function Reject([scriptblock]$action) {$rejected=$false;try {& $action | Out-Null} catch {$rejected=$true};Check $rejected}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$parent=Join-Path $FixtureRoot ('migration-native-'+$CaseName)
[void][IO.Directory]::CreateDirectory($parent)
$acl=New-MPrivateAcl $true $sid
foreach ($pair in @(@('S-1-5-32-545','ReadAndExecute'),@('S-1-5-11','Modify'))) {
    [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($pair[0]),$pair[1],'ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $parent -AclObject $acl
$root=Join-Path $parent 'root'
[void][IO.Directory]::CreateDirectory((Join-Path $root 'windows'))
[IO.File]::WriteAllText((Join-Path $root 'windows/fixture.txt'),'preserve these fixture bytes')
$hash=(Get-FileHash -LiteralPath (Join-Path $root 'windows/fixture.txt') -Algorithm SHA256).Hash
if ($CaseName -ceq 'Lifecycle') {
    Invoke-Migration $root $sid | Out-Null
    $s=Read-MJson (Join-Path $root '.acl-migration/snapshot.json')
    foreach ($e in $s.items) {Assert-MAcl (Read-MAcl (Assert-MPath $root $e.name)) $sid -Private -RequireProtected}
    Invoke-Migration $root $sid | Out-Null
    Invoke-Migration $root $sid -Restore | Out-Null
    Assert-MSame $s.items (Get-MInventory $root $sid $null -MetadataReady) -OriginalAcl
    Invoke-Migration $root $sid | Out-Null
    Check ((Read-MJson (Join-Path $root '.acl-migration/journal.json')).phase -ceq 'committed')
} else {
    $before=(Read-MAcl $root).access
    $stream=[IO.File]::Open((Join-Path $root 'windows/fixture.txt'),[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    try {Reject {Invoke-Migration $root $sid}} finally {$stream.Dispose()}
    Check ((Read-MAcl $root).access -ceq $before)
    $acl=Get-Acl -LiteralPath $root
    [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','Allow'))
    Set-Acl -LiteralPath $root -AclObject $acl
    $before=(Read-MAcl $root).access
    Reject {Invoke-Migration $root $sid}
    Check ((Read-MAcl $root).access -ceq $before)
}
Check ((Get-FileHash -LiteralPath (Join-Path $root 'windows/fixture.txt') -Algorithm SHA256).Hash -ceq $hash)
