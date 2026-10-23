# Shared source, embedded into standalone entry points; no unverified local helper is loaded.
function Initialize-DPNative {
    if ('BuildWorkerDeploymentDiagnostics.Metadata' -as [type]) {return}
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace BuildWorkerDeploymentDiagnostics {
 public sealed class Metadata {
  [StructLayout(LayoutKind.Sequential)] struct TagInfo {public uint Attributes,Tag;}
  [StructLayout(LayoutKind.Sequential)] struct Info {public uint Attr,CLo,CHi,ALo,AHi,WLo,WHi,Volume,SizeHi,SizeLo,Links,IndexHi,IndexLo;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr sa,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int c,out TagInfo i,uint n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  public uint Attributes {get;private set;} public uint Tag {get;private set;} public uint Links {get;private set;}
  public static async System.Threading.Tasks.Task<string> ReadSshCategory(System.IO.Stream stream) {
   byte[] buffer=new byte[4096];using(var prefix=new System.IO.MemoryStream()) {
    int n;while((n=await stream.ReadAsync(buffer,0,buffer.Length))>0) {int keep=Math.Min(n,8192-(int)prefix.Length);if(keep>0)prefix.Write(buffer,0,keep);}
    string text=System.Text.Encoding.UTF8.GetString(prefix.ToArray()).ToLowerInvariant();
    if(text.Contains("host key verification failed")||text.Contains("remote host identification has changed"))return "host-key-pinning-failed";
    if(text.Contains("permission denied"))return "dedicated-key-authentication-refused";
    if(text.Contains("connection refused")||text.Contains("timed out")||text.Contains("network is unreachable"))return "ssh-network-unavailable";
    return "ssh-framing-or-remote-exit";
   }
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {public int Length;public IntPtr Descriptor;public int Inherit;}
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s,uint r,out IntPtr d,out uint z);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string p,ref SecurityAttributes a);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  public static void CreatePrivateDirectory(string path,string sddl) {
   IntPtr descriptor;uint size;
   if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out descriptor,out size))throw new Win32Exception(Marshal.GetLastWin32Error());
   try {
    var attr=new SecurityAttributes {Length=Marshal.SizeOf<SecurityAttributes>(),Descriptor=descriptor,Inherit=0};
    if(!CreateDirectoryW(path,ref attr))throw new Win32Exception(Marshal.GetLastWin32Error());
   } finally {LocalFree(descriptor);}
  }
  public static Metadata Read(string path) {
   using(var h=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
    if(h.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
    TagInfo t;if(!GetFileInformationByHandleEx(h,9,out t,8))throw new Win32Exception(Marshal.GetLastWin32Error());
    Info i;if(!GetFileInformationByHandle(h,out i))throw new Win32Exception(Marshal.GetLastWin32Error());
    return new Metadata {Attributes=t.Attributes,Tag=t.Tag,Links=i.Links};
   }
  }
 }
}
'@
}
function Get-DPKind([long]$Tag) {
    switch ($Tag) {
        2684354563 {return 'junction-or-volume-mount'}
        2684354572 {return 'symbolic-link'}
        2147483671 {return 'windows-overlay-filter'}
        2147483675 {return 'application-execution-alias'}
        2684354589 {return 'linux-symbolic-link'}
        default {if (($Tag -band 0xffff0fffL) -eq 0x9000001aL) {return 'cloud-placeholder'};return 'unknown-reparse-tag'}
    }
}
function Get-DPNode([string]$Path) {
    try {$attrs=[IO.File]::GetAttributes($Path)}
    catch [IO.FileNotFoundException] {return $null}
    catch [IO.DirectoryNotFoundException] {return $null}
    catch {
        $node=@{path=$Path;attributes='unreadable';attributesValue=$null;kind='metadata-unreadable';reparseTag=$null;nameSurrogate=$null;tagQueryError='attribute-query-failed'}
        Throw-DPPath $node $Path 'metadata-query' 'metadata-unreadable'
    }
    $tag=$null;$kind='ordinary';$tagError=$null;$links=$null
    if ([int]$attrs -band 1024) {
        $kind='unclassified-reparse-point'
        if ($IsWindows) {
            try {Initialize-DPNative;$native=[BuildWorkerDeploymentDiagnostics.Metadata]::Read($Path);$tag=[long]$native.Tag;$kind=Get-DPKind $tag;$links=$native.Links}
            catch {$tagError='native-tag-query-failed'}
        } else {$kind='non-windows-reparse-point'}
    }
    return @{path=$Path;attributes=$attrs.ToString();attributesValue=[int]$attrs;reparseTag=if ($null -ne $tag) {'0x'+$tag.ToString('X8')} else {$null};
        kind=$kind;nameSurrogate=if ($null -ne $tag) {($tag -band 0x20000000L) -ne 0} else {$null};tagQueryError=$tagError;links=$links;targetRead=$false}
}
function Throw-DPPath($Node,[string]$Requested,[string]$Operation,[string]$Reason='reparse-point-rejected') {
    $detail=@{stage=$Operation;requestedPath=$Requested;rejectedPath=$Node.path;reason=$Reason;attributes=$Node.attributes;attributesValue=$Node.attributesValue;
        kind=$Node.kind;reparseTag=$Node.reparseTag;nameSurrogate=$Node.nameSurrogate;tagQueryError=$Node.tagQueryError;targetRead=$false}
    $error=[InvalidOperationException]::new(('Deployment path rejected: '+(ConvertTo-Json -InputObject $detail -Compress -Depth 6)))
    $error.Data['deploymentPath']=$detail
    throw $error
}
function Assert-DPPlainPath([string]$Path,[string]$Operation='deployment') {
    # Parent first: never query/resolve a descendant through an untrusted ancestor.
    $ancestors=[Collections.Generic.List[string]]::new()
    for ($p=[IO.Path]::GetFullPath($Path);$p;$p=[IO.Path]::GetDirectoryName($p)) {$ancestors.Add($p)}
    for ($i=$ancestors.Count-1;$i -ge 0;$i--) {
        $node=Get-DPNode $ancestors[$i]
        if ($null -ne $node -and ($node.attributesValue -band 1024)) {Throw-DPPath $node $Path $Operation}
    }
}
function Add-DPIssue($Report,[string]$Stage,[string]$Path,[string]$Code,$Details=$null) {
    $Report.blockers.Add(@{stage=$Stage;path=$Path;code=$Code;details=$Details})
}
function Get-DPStatus([string]$Root,$ObservedPaths=$null) {
    $state=@{migration='absent';snapshot='absent';deployment=@();worker='absent';changedFiles=@();restoreBaselineMatches=$null}
    foreach ($spec in @(@('.acl-migration/journal.json','migration','phase'),@('control/state.json','worker','phase'))) {
        $p=Join-Path $Root $spec[0];Assert-DPPlainPath $p 'state-inspection'
        if ([IO.File]::Exists($p)) {
            if ((Get-Item -Force -LiteralPath $p).Length -gt 1048576) {throw 'State report record oversized'}
            $j=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json -AsHashtable
            $value=$j[$spec[2]]
            $allowed=if ($spec[1] -ceq 'migration') {@('prepared','applying','rolling-back','rollback-failed','rolled-back','committed')} else {@('idle','claiming','download','extracting','ready','building','collecting','upload','finish','blocked')}
            $state[$spec[1]]=if ($value -cin $allowed) {$value} else {'invalid-state'}
        }
    }
    $s=Join-Path $Root '.acl-migration/snapshot.json';$h=Join-Path $Root '.acl-migration/snapshot.sha256.json'
    Assert-DPPlainPath $s 'snapshot-inspection';Assert-DPPlainPath $h 'snapshot-inspection'
    if ([IO.File]::Exists($s)) {
        $state.snapshot='checksum-record-missing'
        if ([IO.File]::Exists($h)) {
            if ((Get-Item -Force -LiteralPath $h).Length -gt 65536) {throw 'Snapshot checksum record oversized'}
            $sha=Get-Content -LiteralPath $h -Raw | ConvertFrom-Json -AsHashtable
            $state.snapshot=if ($sha.sha256 -ceq (Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash) {'checksum-valid'} else {'checksum-mismatch'}
        }
    }
    if ($state.snapshot -ceq 'checksum-valid') {
        if ((Get-Item -Force -LiteralPath $s).Length -gt 33554432) {throw 'ACL snapshot oversized'}
        $baseline=Get-Content -LiteralPath $s -Raw | ConvertFrom-Json -AsHashtable
        if ($baseline.version -ne 1 -or $baseline.root -cne $Root -or $baseline.items.Count -gt 20000) {throw 'Invalid ACL snapshot identity'}
        foreach ($e in $baseline.items) {
            $p=Assert-MPath $Root $e.name
            if (-not [IO.Path]::Exists($p)) {$state.changedFiles+=@{name=$e.name;reason='missing'};continue}
            $view=Read-MAcl $p
            if ($view.owner -cne $e.owner -or $view.group -cne $e.group) {$state.changedFiles+=@{name=$e.name;reason='owner-or-group-changed'}}
            if (-not $e.directory -and ((Get-Item -Force -LiteralPath $p).Length -ne $e.size -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -cne $e.sha256)) {$state.changedFiles+=@{name=$e.name;reason='content-changed'}}
        }
        if ($null -ne $ObservedPaths) {
            $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            foreach ($entry in $baseline.items) {[void]$names.Add($entry.name)}
            foreach ($entry in $ObservedPaths) {
                $name=[IO.Path]::GetRelativePath($Root,$entry.path).Replace('\','/');if ($name -ceq '.') {$name=''}
                if ($name -ceq '.acl-migration' -or $name.StartsWith('.acl-migration/')) {continue}
                if (-not $names.Contains($name)) {$state.changedFiles+=@{name=$name;reason='added'}}
            }
        }
        $state.restoreBaselineMatches=$state.changedFiles.Count -eq 0
    }
    foreach ($parent in @('control/packages','control/backups')) {
        $path=Join-Path $Root $parent;Assert-DPPlainPath $path 'backup-inspection'
        if (-not [IO.Directory]::Exists($path)) {continue}
        foreach ($dir in Get-ChildItem -LiteralPath $path -Directory -Force) {
            Assert-DPPlainPath $dir.FullName 'backup-inspection'
            $p=Join-Path $dir.FullName 'deployment-transaction.json';Assert-DPPlainPath $p 'backup-inspection'
            if ([IO.File]::Exists($p)) {
                if ((Get-Item -Force -LiteralPath $p).Length -gt 1048576) {throw 'Deployment journal oversized'}
                $j=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json -AsHashtable
                $phase=if ($j.status -cin @('pending','rollback-failed','rolled-back','committed')) {$j.status} else {'invalid-state'}
                $state.deployment+=@{path=$p;status=$phase}
            }
        }
    }
    return $state
}
function Get-DPPreflight([string]$Root,[string]$UserSid,[switch]$NativeLocks) {
    $report=@{version=1;root=$Root;utc=[DateTime]::UtcNow.ToString('o');readOnly=$true;ready=$false;needsAclMigration=$false;
        inspected=0;fileBytes=0;blockers=[Collections.Generic.List[object]]::new();paths=[Collections.Generic.List[object]]::new();state=$null;
        unverified=@('Windows functional ACL/owner/inheritance probes','SSH Agent authentication under the actual setup token','VPS job availability and artifact return')}
    try {Assert-DPPlainPath $Root 'root-and-parent-preflight'}
    catch {Add-DPIssue $report 'root-and-parent' $Root 'unsafe-path' $_.Exception.Data['deploymentPath'];return $report}
    if (-not [IO.Directory]::Exists($Root)) {Add-DPIssue $report 'root' $Root 'root-missing';return $report}
    $pins=[Collections.Generic.List[object]]::new();$stack=[Collections.Generic.Stack[string]]::new();$stack.Push('')
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    try {
        if ($NativeLocks) {Initialize-MNative}
        while ($stack.Count) {
            $name=$stack.Pop();$path=Join-Path $Root $name
            if (++$report.inspected -gt 20000) {Add-DPIssue $report 'inventory' $path 'inventory-limit';break}
            $stage='path-check';$view=$null
            try {
                [void](Assert-MPath $Root $name)
                if (-not $seen.Add($name)) {throw 'Case collision'}
                $directory=[IO.Directory]::Exists($path)
                $stage='owner-and-ace-policy';$view=Read-MAcl $path
                Assert-MAcl $view $UserSid
                if (@($view.rules | Where-Object {$_.sid -cin @('S-1-5-32-545','S-1-5-11')}).Count) {$report.needsAclMigration=$true}
                $stage='file-lock-and-write-dacl';if ($NativeLocks) {$pins.Add((New-MPin $path $directory))}
                $report.paths.Add(@{path=$path;directory=$directory;owner=$view.owner;protected=$view.protected;aclPolicy='approved';rules=$view.rules;writeDaclAndPin=if ($NativeLocks) {'passed'} else {'not-tested'}})
                $stage='enumeration-or-hash'
                if ($directory) {
                    foreach ($child in Get-ChildItem -LiteralPath $path -Force) {$stack.Push($(if ($name) {$name+'/'+$child.Name} else {$child.Name}))}
                } else {$report.fileBytes+=(Get-Item -Force -LiteralPath $path).Length;if ($report.fileBytes -gt 42949672960) {throw 'Tree size limit'};[void](Get-FileHash -LiteralPath $path -Algorithm SHA256)}
            } catch {
                $d=$_.Exception.Data['deploymentPath']
                if (-not $d -and $_.Exception.Data.Contains('pinFailure')) {$d=$_.Exception.Data['pinFailure']}
                if (-not $d) {$d=@{operation=$stage;exceptionType=$_.Exception.GetType().Name;owner=if ($view) {$view.owner} else {$null};rules=if ($view) {$view.rules} else {@()}}}
                Add-DPIssue $report $stage $path $(if ($_.Exception.Data['deploymentPath']) {'unsafe-path'} else {'acl-lock-or-inventory-rejected'}) $d
            }
        }
        try {Assert-MIdle $Root} catch {Add-DPIssue $report 'worker-state' (Join-Path $Root 'control') 'disabled-idle-required'}
        try {
            $report.state=Get-DPStatus $Root $report.paths
            if ($report.state.migration -ceq 'invalid-state' -or ($report.state.migration -cne 'absent' -and $report.state.snapshot -ceq 'absent')) {Add-DPIssue $report 'backup' $Root 'invalid-or-missing-migration-backup'}
            if ($report.state.migration -cin @('prepared','applying','rolling-back','rollback-failed') -and ($report.state.restoreBaselineMatches -eq $false -or $report.state.snapshot -cne 'checksum-valid')) {Add-DPIssue $report 'backup' $Root 'migration-recovery-baseline-not-verified'}
            if ($report.state.snapshot -ceq 'checksum-mismatch') {Add-DPIssue $report 'backup' $Root 'snapshot-checksum-mismatch'}
            foreach ($d in $report.state.deployment) {if ($d.status -cin @('pending','rollback-failed','invalid-state')) {Add-DPIssue $report 'deployment-backup' $d.path 'recover-deployment-first'}}
        } catch {Add-DPIssue $report 'state-inspection' $Root 'unsafe-or-invalid-state' $_.Exception.Data['deploymentPath']}
    } finally {for ($i=$pins.Count-1;$i -ge 0;$i--) {$pins[$i].Dispose()}}
    $report.ready=$report.blockers.Count -eq 0
    return $report
}
