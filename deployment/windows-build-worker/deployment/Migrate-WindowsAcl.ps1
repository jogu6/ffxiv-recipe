#requires -Version 7.4
# Standalone, offline DACL migration. Existing content/owners are never written.
[CmdletBinding()]
param([switch]$RestoreOnly,[switch]$Diagnose)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# BEGIN EMBEDDED PREFLIGHT
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

# END EMBEDDED PREFLIGHT

function Assert-MPath([string]$Root, [string]$Name) {
    if ($Name -and ($Name.Length -gt 240 -or $Name -match '(^/|\\|:|(^|/)\.{1,2}(/|$)|//|[\x00-\x1f])')) { throw 'Unsafe ACL migration path' }
    foreach ($part in $Name.Split('/')) {
        if ($part -and ($part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)')) { throw 'Ambiguous Windows path' }
        if ($part -in @('.ssh','gcal-ci','ffxiv-recipe') -or ($part -match '^(id_(rsa|ed25519|ecdsa)|buildworker_ed25519)(\.|$)' -or $part -match '\.(pem|key|ppk)$')) { throw 'Out-of-scope project/SSH key path; nothing migrated' }
    }
    $path = if ($Name) { [IO.Path]::GetFullPath((Join-Path $Root $Name)) } else { $Root }
    if ($path -ine $Root -and -not $path.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'ACL migration root escape' }
    Assert-DPPlainPath $path 'acl-migration'
    if ([IO.File]::Exists($path) -and (Get-Item -Force -LiteralPath $path).LinkType -ceq 'HardLink') { throw 'ACL migration hard link rejected' }
    return $path
}
function Initialize-MNative {
    if ('BuildWorkerAclMigration.Pin' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace BuildWorkerAclMigration {
 public sealed class Pin : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct Info {
   public uint Attr, CLo, CHi, ALo, AHi, WLo, WHi, Volume, SizeHi, SizeLo, Links, IndexHi, IndexLo;
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr sa,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  readonly SafeFileHandle handle;
  public string Identity {get;}
  public bool Directory {get;}
  public Pin(string path,bool directory) {
   // Never follow reparse points, never share DELETE; file pins also exclude data writers.
   handle=CreateFileW(path,directory?0x60080u:0x60081u,directory?3u:1u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
   if(handle.IsInvalid) {int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
   try {
    Info i;if(!GetFileInformationByHandle(handle,out i))throw new Win32Exception(Marshal.GetLastWin32Error());
    Directory=(i.Attr&16)!=0;
    if((i.Attr&0x400)!=0||Directory!=directory||(!directory&&i.Links!=1))throw new InvalidOperationException("Linked/replaced migration target");
    Identity=i.Volume.ToString("x8")+":"+i.IndexHi.ToString("x8")+i.IndexLo.ToString("x8");
   } catch {handle.Dispose();throw;}
  }
  public void Dispose(){handle.Dispose();}
 }
}
'@
}
function New-MPin([string]$Path, [bool]$Directory) {
    try {return [BuildWorkerAclMigration.Pin]::new($Path,$Directory)}
    catch {
        $base=$_.Exception.GetBaseException();$code=if ($base -is [ComponentModel.Win32Exception]) {$base.NativeErrorCode} else {$null}
        $kind=switch ($code) {5 {'access-denied'} 32 {'sharing-violation'} 33 {'lock-violation'} default {'native-pin-rejected'}}
        $error=[InvalidOperationException]::new(('Cannot pin/read/write-DACL: '+$Path))
        $error.Data['pinFailure']=@{path=$Path;classification=$kind;nativeErrorCode=$code;aclChanged=$false}
        throw $error
    }
}
function Convert-MRawAcl($Raw) {
    if ($null -eq $Raw.DiscretionaryAcl -or $Raw.DiscretionaryAcl.Count -eq 0) { throw 'Null/empty DACL requires manual review' }
    $rules = @()
    foreach ($ace in $Raw.DiscretionaryAcl) {
        $common = $ace -is [Security.AccessControl.CommonAce]
        $rules += @{common=$common; callback=if ($common) {$ace.IsCallback} else {$true}; type=if ($common) {$ace.AceQualifier.ToString()} else {'unknown'};
            sid=if ($common) {$ace.SecurityIdentifier.Value} else {''}; flags=[int]$ace.AceFlags; mask=if ($common) {$ace.AccessMask} else {0}}
    }
    return @{owner=$Raw.Owner.Value;group=$Raw.Group.Value;access=$Raw.GetSddlForm([Security.AccessControl.AccessControlSections]::Access);
        descriptor=$Raw.GetSddlForm([Security.AccessControl.AccessControlSections]'Owner,Group,Access');rules=$rules;
        protected=([int]$Raw.ControlFlags -band 4096) -ne 0}
}
function Read-MAcl([string]$Path) {
    $acl=Get-Acl -LiteralPath $Path
    return (Convert-MRawAcl ([Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)))
}
function Read-MSavedAcl([string]$Sddl) {return (Convert-MRawAcl ([Security.AccessControl.RawSecurityDescriptor]::new($Sddl)))}
function Assert-MAcl($Acl, [string]$UserSid, [switch]$Private, [switch]$RequireProtected) {
    $trusted = @($UserSid,'S-1-5-32-544','S-1-5-18')
    $broad = @('S-1-5-32-545','S-1-5-11')
    if ($trusted -notcontains $Acl.owner) { throw 'Unknown owner; ACL migration refused' }
    if ($Acl.rules.Count -eq 0) { throw 'Empty ACL refused' }
    foreach ($r in $Acl.rules) {
        if (-not $r.common -or $r.callback -or $r.type -cne 'AccessAllowed' -or ($r.flags -band 0xffffffe0L) -ne 0 -or
            (([long]$r.mask -band 0xffffffffL) -band 0x0fe0fe00L) -ne 0) { throw 'Unknown/deny/conditional ACE or access mask; ACL migration refused' }
        if ($trusted -notcontains $r.sid -and ($Private -or $broad -notcontains $r.sid)) { throw ('Unapproved ACE SID: ' + $r.sid) }
    }
    if ($RequireProtected) {
        if (-not $Private -or -not $Acl.protected) {throw 'Migration directory/target ACL must be protected'}
        foreach ($sid in $trusted) {
            if (@($Acl.rules | Where-Object { $_.sid -ceq $sid -and ($_.flags -band 8) -eq 0 -and ($_.mask -band 0x1f01ff) -eq 0x1f01ff }).Count -eq 0) {throw 'Required trusted FullControl grant missing'}
        }
    }
}
function New-MPrivateAcl([bool]$Directory, [string]$UserSid) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($UserSid,'S-1-5-32-544','S-1-5-18')) {
        [void]$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl',$(if ($Directory) {'ContainerInherit,ObjectInherit'} else {'None'}),'None','Allow'))
    }
    return $acl
}
function Set-MPrivateAcl([string]$Path, [bool]$Directory, [string]$UserSid) { Set-Acl -LiteralPath $Path -AclObject (New-MPrivateAcl $Directory $UserSid) }
function Set-MOriginalAcl([string]$Path, [string]$Sddl) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetSecurityDescriptorSddlForm($Sddl, [Security.AccessControl.AccessControlSections]::Access)
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function New-MMetadata([string]$Path, [string]$UserSid) {
    # Create the new metadata directory with its private DACL from the outset.
    [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path), (New-MPrivateAcl $true $UserSid))
}
function Write-MJson([string]$Path, $Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 20 -Compress))
    if ($bytes.Length -gt 33554432) { throw 'Migration metadata too large' }
    $temp = $Path + '.tmp'
    $stream = [IO.File]::Open($temp,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.Write($bytes);$stream.Flush($true)} finally {$stream.Dispose()}
    [IO.File]::Move($temp,$Path,$true)
}
function Read-MJson([string]$Path) {
    if ((Get-Item -Force -LiteralPath $Path).Length -gt 33554432) { throw 'Oversized migration record' }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable)
}
function Assert-MIdle([string]$Root) {
    foreach ($name in @('control/worker.json','control/state.json')) {
        $path = Assert-MPath $Root $name
        if (-not [IO.File]::Exists($path)) {continue}
        if ((Get-Item -Force -LiteralPath $path).Length -gt 1048576) {throw 'Oversized worker control file'}
        $v = Read-MJson $path
        if (($name.EndsWith('worker.json') -and ($v.enabled -isnot [bool] -or $v.enabled)) -or
            ($name.EndsWith('state.json') -and $v.phase -cne 'idle')) {throw 'Enabled worker or unresolved job; no ACL migration started'}
    }
}
function Get-MInventory([string]$Root, [string]$UserSid, $Pins, [switch]$MetadataReady) {
    $stack = [Collections.Generic.Stack[string]]::new(); $stack.Push('')
    $unique=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $items = [Collections.Generic.List[object]]::new(); [long]$bytes=0; [long]$metadataBytes=0
    while ($stack.Count) {
        $name=$stack.Pop();if (-not $unique.Add($name)) {throw 'Case-colliding migration paths'};$path=Assert-MPath $Root $name
        $directory=[IO.Directory]::Exists($path)
        if ($null -ne $Pins) { $Pins.Add((New-MPin $path $directory)) }
        $acl=Read-MAcl $path;Assert-MAcl $acl $UserSid
        $identity=if ($null -ne $Pins) {$Pins[$Pins.Count-1].Identity} else {''}
        $item=@{name=$name;directory=$directory;owner=$acl.owner;group=$acl.group;access=$acl.access;descriptor=$acl.descriptor;identity=$identity;size=0;sha256=$null}
        if ($directory) {
            foreach ($child in Get-ChildItem -LiteralPath $path -Force) {
                $relative=if ($name) {$name+'/'+$child.Name} else {$child.Name}
                [void](Assert-MPath $Root $relative)
                if ($relative -ceq '.acl-migration') {
                    if (-not $MetadataReady) {throw 'Reserved migration metadata already exists'}
                    continue
                }
                $stack.Push($relative)
            }
        } else {
            $item.size=(Get-Item -Force -LiteralPath $path).Length;$bytes+=$item.size
            if ($bytes -gt 42949672960) {throw 'Migration tree exceeds 40GiB; review required'}
            $item.sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        }
        $metadataBytes+=$item.descriptor.Length+$item.name.Length
        if ($items.Count -ge 20000 -or $metadataBytes -gt 16000000) {throw 'Migration inventory limit exceeded'}
        $items.Add($item)
    }
    return ,@($items | Sort-Object -Property name)
}
function Assert-MSame($Expected, $Actual, [switch]$OriginalAcl) {
    if ($Expected.Count -ne $Actual.Count) {throw 'Migration inventory changed; records retained'}
    for ($i=0;$i -lt $Expected.Count;$i++) {
        $a=$Expected[$i];$b=$Actual[$i]
        foreach ($key in @('name','directory','owner','group','size','sha256')) {if ($a[$key] -cne $b[$key]) {throw 'Migration file/hash/owner changed; refusing automatic overwrite'}}
        if ($a.identity -and $b.identity -and $a.identity -cne $b.identity) {throw 'Migration object was replaced'}
        if ($OriginalAcl -and $a.access -cne $b.access) {throw 'Original DACL restoration mismatch'}
    }
}
function Assert-MMetadata([string]$Root, [string]$UserSid) {
    $directory=Assert-MPath $Root '.acl-migration'
    Assert-MAcl (Read-MAcl $directory) $UserSid -Private -RequireProtected
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
        if ($item.Name -notin @('snapshot.json','snapshot.sha256.json','journal.json','snapshot.json.tmp','snapshot.sha256.json.tmp','journal.json.tmp','compiler-temp')) {throw 'Unknown migration metadata file'}
        [void](Assert-MPath $Root ('.acl-migration/'+$item.Name))
        Assert-MAcl (Read-MAcl $item.FullName) $UserSid -Private
        if ($item.PSIsContainer -and $item.Name -cne 'compiler-temp') {throw 'Unexpected migration metadata directory'}
        if ($item.PSIsContainer) {
            Assert-MAcl (Read-MAcl $item.FullName) $UserSid -Private -RequireProtected
            $stack=[Collections.Generic.Stack[string]]::new();$stack.Push($item.FullName);$count=0
            while ($stack.Count) {
                foreach ($child in Get-ChildItem -LiteralPath $stack.Pop() -Force) {
                    $relative=[IO.Path]::GetRelativePath($Root,$child.FullName).Replace('\','/')
                    [void](Assert-MPath $Root $relative)
                    Assert-MAcl (Read-MAcl $child.FullName) $UserSid -Private
                    if (++$count -gt 20000) {throw 'Compiler scratch inventory limit exceeded'}
                    if ($child.PSIsContainer) {$stack.Push($child.FullName)}
                }
            }
        }
    }
}
function Restore-MSnapshot([string]$Root, [string]$UserSid, $Snapshot, $Journal, [string]$JournalPath) {
    $now=Get-MInventory $Root $UserSid $null -MetadataReady
    Assert-MSame $Snapshot.items $now
    $Journal.phase='rolling-back';Write-MJson $JournalPath $Journal
    # Parent-first: restore the original inheritance graph; private metadata remains protected.
    foreach ($e in @($Snapshot.items | Sort-Object {($_.name -split '/').Count},name)) {
        $path=Assert-MPath $Root $e.name
        $Journal.intent=$e.name;Write-MJson $JournalPath $Journal
        Set-MOriginalAcl $path $e.access
    }
    Assert-MSame $Snapshot.items (Get-MInventory $Root $UserSid $null -MetadataReady) -OriginalAcl
    $Journal.phase='rolled-back';$Journal.intent=$null;Write-MJson $JournalPath $Journal
}
function Invoke-Migration([string]$Root, [string]$UserSid, [switch]$Restore) {
    $pins=[Collections.Generic.List[object]]::new();$oldTemp=$env:TEMP;$oldTmp=$env:TMP
    $snapshot=$null;$journal=$null;$mutating=$false
    $meta=Join-Path $Root '.acl-migration';$journalPath=Join-Path $meta 'journal.json'
    try {
        [void](Assert-MPath $Root '')
        Assert-MAcl (Read-MAcl $Root) $UserSid
        Assert-MIdle $Root
        if (-not [IO.Directory]::Exists($meta)) {
            if ($Restore) {throw 'No migration backup exists'}
            New-MMetadata $meta $UserSid | Out-Null
        }
        Assert-MMetadata $Root $UserSid
        $scratch=Join-Path $meta 'compiler-temp'
        if (-not [IO.Directory]::Exists($scratch)) {New-MMetadata $scratch $UserSid | Out-Null}
        $env:TEMP=$scratch;$env:TMP=$scratch
        Initialize-MNative
        $pins.Add((New-MPin $Root $true));$pins.Add((New-MPin $meta $true));$pins.Add((New-MPin $scratch $true))
        $items=Get-MInventory $Root $UserSid $pins -MetadataReady
        Assert-MIdle $Root
        $snapshotPath=Join-Path $meta 'snapshot.json';$shaPath=Join-Path $meta 'snapshot.sha256.json'
        if ([IO.File]::Exists($snapshotPath)) {
            $missingChecksum=-not [IO.File]::Exists($shaPath)
            if ($missingChecksum -and [IO.File]::Exists($journalPath)) {throw 'ACL snapshot checksum missing after journal creation'}
            if (-not $missingChecksum) {
                $sha=Read-MJson $shaPath
                if ($sha.sha256 -cne (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash) {throw 'ACL snapshot checksum mismatch'}
            }
            $snapshot=Read-MJson $snapshotPath
            if ($snapshot.version -ne 1 -or $snapshot.root -cne $Root -or $snapshot.user -cne $UserSid -or $snapshot.items.Count -gt 20000) {throw 'ACL snapshot identity mismatch'}
            # Validate the immutable restore paths and original ACEs before trusting their inventory.
            $unique=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            foreach ($e in $snapshot.items) {
                [void](Assert-MPath $Root $e.name)
                $saved=Read-MSavedAcl $e.descriptor;Assert-MAcl $saved $UserSid
                if ($saved.owner -cne $e.owner -or $saved.group -cne $e.group -or $saved.access -cne $e.access) {throw 'ACL snapshot descriptor mismatch'}
                if ($e.name -ceq '.acl-migration' -or $e.name.StartsWith('.acl-migration/') -or -not $unique.Add($e.name)) {throw 'Invalid ACL snapshot inventory'}
            }
            Assert-MSame $snapshot.items $items
            if ($missingChecksum) {
                # No journal means the durable mutation barrier was never crossed.
                Assert-MSame $snapshot.items $items -OriginalAcl
                Write-MJson $shaPath @{sha256=(Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash}
            }
            if (-not [IO.File]::Exists($journalPath)) {
                Assert-MSame $snapshot.items $items -OriginalAcl
                $journal=@{version=1;root=$Root;phase='prepared';intent=$null};Write-MJson $journalPath $journal
            } else {$journal=Read-MJson $journalPath}
            if ($journal.version -ne 1 -or $journal.root -cne $Root -or $journal.phase -cnotin @('prepared','applying','rolling-back','rollback-failed','rolled-back','committed')) {throw 'Unknown migration journal'}
        } else {
            if ($Restore -or [IO.File]::Exists($shaPath) -or [IO.File]::Exists($journalPath)) {throw 'Missing immutable ACL snapshot'}
            $snapshot=@{version=1;root=$Root;user=$UserSid;items=$items;utc=[DateTime]::UtcNow.ToString('o')}
            Write-MJson $snapshotPath $snapshot
            Write-MJson $shaPath @{sha256=(Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash}
            $journal=@{version=1;root=$Root;phase='prepared';intent=$null};Write-MJson $journalPath $journal
        }
        if ($Restore -or $journal.phase -in @('applying','rolling-back','rollback-failed')) {
            Restore-MSnapshot $Root $UserSid $snapshot $journal $journalPath
            if ($Restore) {Write-Output 'Original DACLs restored; owners and contents unchanged.';return}
        }
        if ($journal.phase -ceq 'committed') {
            foreach ($e in $items) {Assert-MAcl (Read-MAcl (Assert-MPath $Root $e.name)) $UserSid -Private -RequireProtected}
            Write-Output 'ACL migration already complete; contents and owners verified.';return
        }
        Assert-MSame $snapshot.items (Get-MInventory $Root $UserSid $null -MetadataReady) -OriginalAcl
        $journal.phase='applying';Write-MJson $journalPath $journal;$mutating=$true
        # Leaves first: protected descendants cannot receive uncontrolled parent propagation.
        foreach ($e in @($snapshot.items | Sort-Object {($_.name -split '/').Count},name -Descending)) {
            $path=Assert-MPath $Root $e.name
            $journal.intent=$e.name;Write-MJson $journalPath $journal
            Set-MPrivateAcl $path $e.directory $UserSid
            Assert-MAcl (Read-MAcl $path) $UserSid -Private -RequireProtected
        }
        Assert-MSame $snapshot.items (Get-MInventory $Root $UserSid $null -MetadataReady)
        foreach ($e in $snapshot.items) {Assert-MAcl (Read-MAcl (Assert-MPath $Root $e.name)) $UserSid -Private -RequireProtected}
        $journal.phase='committed';$journal.intent=$null;Write-MJson $journalPath $journal;$mutating=$false
        Write-Output ('ACL migration complete; file hashes/owners unchanged. Backup: '+$meta)
    } catch {
        if ($mutating) {
            try {Restore-MSnapshot $Root $UserSid $snapshot $journal $journalPath}
            catch {$journal.phase='rollback-failed';Write-MJson $journalPath $journal;Write-Warning 'ACL restore incomplete; retain .acl-migration and rerun the same script. No files were deleted.'}
        }
        throw
    } finally {
        for ($i=$pins.Count-1;$i -ge 0;$i--) {$pins[$i].Dispose()}
        $env:TEMP=$oldTemp;$env:TMP=$oldTmp
    }
}
# Dot-sourcing defines functions for isolated tests only; the shipped entry point has no root override.
if ($MyInvocation.InvocationName -ceq '.') {return}
if (-not $IsWindows) {throw 'Windows 11 and PowerShell 7.4+ required'}
$root='C:\BuildWorker-Production'
if ([IO.Path]::GetFullPath($PSCommandPath) -ine 'C:\BuildWorker-Production\Migrate-WindowsAcl.ps1') {throw 'Place this standalone script at C:\BuildWorker-Production\Migrate-WindowsAcl.ps1'}
$user=[Security.Principal.WindowsIdentity]::GetCurrent()
$expectedSid=([Security.Principal.NTAccount]::new($env:COMPUTERNAME,'ladmin')).Translate([Security.Principal.SecurityIdentifier]).Value
if ($Diagnose -and $RestoreOnly) {throw 'Diagnosis is read-only; do not combine RestoreOnly'}
if ($user.User.Value -cne $expectedSid -or (-not $Diagnose -and -not ([Security.Principal.WindowsPrincipal]::new($user)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) {throw 'Run PowerShell as the existing local ladmin with an elevated token; no ownership is taken'}
if ($Diagnose) {Get-DPPreflight $root $expectedSid -NativeLocks | ConvertTo-Json -Depth 18;return}
$mutex=[Threading.Mutex]::new($false,'Global\BuildWorker-C-BuildWorker-v1');$locked=$false
try {
    try {$locked=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
    if (-not $locked) {throw 'Worker/deployment is active; no migration started'}
    Invoke-Migration $root $expectedSid -Restore:$RestoreOnly
} finally {if ($locked) {$mutex.ReleaseMutex()};$mutex.Dispose()}
