using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;

namespace BuildWorker {
    public sealed class Rejected : Exception { public Rejected(string code) : base(code) {} }
    public sealed class TransportFailure : Exception { public TransportFailure() : base("transport_failed") {} }
    public sealed class RemoteFailure : Exception {
        public string Code { get; }
        public RemoteFailure(string code) : base("remote_rejected") { Code = code; }
    }
    public static class Guard {
        public static void Check(bool ok, string code="invalid") { if (!ok) throw new Rejected(code); }
        public static string Id(string value) {
            Check(value != null && System.Text.RegularExpressions.Regex.IsMatch(value, @"\A[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\z"));
            return value;
        }
        public static string Sha(string value) {
            Check(value != null && System.Text.RegularExpressions.Regex.IsMatch(value, @"\A[0-9a-f]{64}\z")); return value;
        }
        public static string Portable(string value) {
            Check(value != null && value.Length > 0 && value.Length <= 240);
            foreach (string part in value.Split('/')) {
                Check(part.Length > 0 && part != "." && part != ".." && !part.EndsWith(".") && !part.EndsWith(" "));
                Check(!System.Text.RegularExpressions.Regex.IsMatch(part, @"\A(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
                Check(!part.Any(c => c < 32 || c > 126 || "\\:<>\"|?*".Contains(c)));
            }
            return value;
        }
        public static void Unique(string[] paths) {
            var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var spelling = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach (string path in paths) {
                Portable(path); Check(files.Add(path), "path_collision");
                var parts = path.Split('/'); string prefix = "";
                foreach (string part in parts) {
                    prefix = prefix.Length == 0 ? part : prefix + "/" + part;
                    if (spelling.TryGetValue(prefix, out string old)) Check(old == prefix, "path_collision");
                    spelling[prefix] = prefix;
                }
            }
            foreach (string path in paths) {
                string[] parts=path.Split('/'); string prefix="";
                for (int i=0; i<parts.Length-1; i++) {
                    prefix=i==0 ? parts[i] : prefix+"/"+parts[i]; Check(!files.Contains(prefix), "path_collision");
                }
            }
        }
        public static void Keys(JsonElement value, string[] required, string[] optional=null) {
            Check(value.ValueKind==JsonValueKind.Object);
            var names = value.EnumerateObject().Select(p=>p.Name).ToArray();
            Check(required.All(n=>names.Contains(n)) && names.All(n=>required.Contains(n)||(optional??Array.Empty<string>()).Contains(n)), "unknown_fields");
        }
        public static long Number(JsonElement value, long min, long max) {
            Check(value.ValueKind==JsonValueKind.Number && value.TryGetInt64(out long unused));
            long n=value.GetInt64(); Check(n>=min && n<=max); return n;
        }
        public static string Text(JsonElement value) { Check(value.ValueKind==JsonValueKind.String); return value.GetString(); }
        public static JsonElement Json(string text) {
            Check(text!=null && text.Length<=8*1024*1024);
            using (var doc=JsonDocument.Parse(text,new JsonDocumentOptions { MaxDepth=64 })) {
                ValidateJson(doc.RootElement); return doc.RootElement.Clone();
            }
        }
        static void ValidateJson(JsonElement value) {
            if(value.ValueKind==JsonValueKind.Object) {
                var seen=new HashSet<string>(StringComparer.Ordinal);
                foreach(var p in value.EnumerateObject()) { Check(seen.Add(p.Name),"duplicate_json_key"); ValidateJson(p.Value); }
            } else if(value.ValueKind==JsonValueKind.Array) foreach(var v in value.EnumerateArray()) ValidateJson(v);
        }
        static void Quoted(StringBuilder b,string value) {
            b.Append('"'); foreach(char c in value) {
                switch(c) {
                    case '"': b.Append("\\\""); break; case '\\': b.Append("\\\\"); break;
                    case '\b': b.Append("\\b"); break; case '\f': b.Append("\\f"); break;
                    case '\n': b.Append("\\n"); break; case '\r': b.Append("\\r"); break; case '\t': b.Append("\\t"); break;
                    default: if(c<32 || c>126) b.Append("\\u"+((int)c).ToString("x4")); else b.Append(c); break;
                }
            } b.Append('"');
        }
        static void Canonical(StringBuilder b,JsonElement value) {
            switch(value.ValueKind) {
                case JsonValueKind.Object:
                    b.Append('{'); bool first=true;
                    foreach(var p in value.EnumerateObject().OrderBy(p=>p.Name,StringComparer.Ordinal)) {
                        if(!first)b.Append(','); first=false; Quoted(b,p.Name); b.Append(':'); Canonical(b,p.Value);
                    } b.Append('}'); break;
                case JsonValueKind.Array:
                    b.Append('['); bool start=true; foreach(var v in value.EnumerateArray()) {
                        if(!start)b.Append(','); start=false; Canonical(b,v);
                    } b.Append(']'); break;
                case JsonValueKind.String: Quoted(b,value.GetString()); break;
                case JsonValueKind.Number: b.Append(Number(value,long.MinValue,long.MaxValue).ToString(System.Globalization.CultureInfo.InvariantCulture)); break;
                case JsonValueKind.True: b.Append("true"); break; case JsonValueKind.False: b.Append("false"); break;
                case JsonValueKind.Null: b.Append("null"); break; default: throw new Rejected("invalid_json");
            }
        }
        public static string CanonicalJson(string json) { var b=new StringBuilder(); Canonical(b,Json(json)); return b.ToString(); }
        public static string Revision(string definition) { return Hash(Encoding.ASCII.GetBytes(CanonicalJson(definition))); }
        public static string Hash(byte[] bytes) { return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(); }
        public static string HashFile(string path,Action pulse=null) {
            using(var file=File.Open(path,FileMode.Open,FileAccess.Read,FileShare.Read))
            using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
                var buffer=new byte[262144]; int count;
                while((count=file.Read(buffer,0,buffer.Length))>0) { hash.AppendData(buffer,0,count); pulse?.Invoke(); }
                return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            }
        }
    }
    public static class Paths {
        static StringComparison Comparison => OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal;
        public static string Inside(string root,string relative) {
            Guard.Portable(relative); string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
            string prefix=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            Guard.Check(full.StartsWith(prefix,Comparison),"path_escape"); NoLinks(full); return full;
        }
        public static void NoLinks(string path) {
            path=Path.GetFullPath(path);
            var ancestors=new Stack<string>();
            for(string current=path;current!=null;current=Path.GetDirectoryName(current))ancestors.Push(current);
            while(ancestors.Count>0) {
                string current=ancestors.Pop();
                try {
                    var attributes=File.GetAttributes(current);
                    if((attributes&FileAttributes.ReparsePoint)!=0) {
                        var error=new Rejected("reparse_point");
                        error.Data["deploymentPath"]=new Dictionary<string,object> {
                            ["stage"]="worker-runtime",["requestedPath"]=path,["rejectedPath"]=current,
                            ["attributes"]=attributes.ToString(),["attributesValue"]=(int)attributes,
                            ["kind"]="runtime-reparse-point",["reparseTag"]=null,["targetRead"]=false
                        };
                        throw error;
                    }
                } catch(FileNotFoundException) {} catch(DirectoryNotFoundException) {}
            }
        }
        public static long Usage(string root,long stopAfter) {
            NoLinks(root); if(!Directory.Exists(root))return 0;
            var timer=Stopwatch.StartNew();long sum=0; var todo=new Stack<string>();todo.Push(root); int count=0;
            while(todo.Count>0) {
                string directory=todo.Pop();
                if(!Directory.Exists(directory))continue;
                if((File.GetAttributes(directory)&FileAttributes.ReparsePoint)!=0)NoLinks(directory);
                // Enumeration already supplies attributes and file size on Windows.
                // Reopening each dependency file just for metadata makes large Cargo caches unscannable.
                foreach(var entry in new DirectoryInfo(directory).EnumerateFileSystemInfos()) {
                    Guard.Check(++count<=1000000&&timer.Elapsed.TotalSeconds<30,"capacity_scan_limit");
                    // Each parent is checked before traversal; avoid querying all its ancestors for every file.
                    // Package installation can remove entries between enumeration and the metadata read.
                    try {
                        var attributes=entry.Attributes;
                        if((attributes&FileAttributes.ReparsePoint)!=0)NoLinks(entry.FullName);
                        if((attributes&FileAttributes.Directory)!=0)todo.Push(entry.FullName);
                        else sum=checked(sum+((FileInfo)entry).Length);
                    } catch(FileNotFoundException) {} catch(DirectoryNotFoundException) {}
                    if(sum>stopAfter)return sum;
                }
            } return sum;
        }
        public static bool Capacity(long free,long used,long minimumFree,long maxUsed,long reservation) {
            return free>=minimumFree+reservation && used<=maxUsed-reservation;
        }
        public static void AtomicText(string root,string relative,string text) {
            string path=Inside(root,relative); Directory.CreateDirectory(Path.GetDirectoryName(path)); NoLinks(path);
            string temporary=path+".tmp-"+Guid.NewGuid().ToString("N");
            try {
                using(var f=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                    byte[] bytes=Encoding.UTF8.GetBytes(text); f.Write(bytes); f.Flush(true);
                }
                File.Move(temporary,path,true);
            } finally { if(File.Exists(temporary))File.Delete(temporary); }
        }
        public static void CopyBounded(string from,string to,long size,Action pulse=null) {
            NoLinks(from); NoLinks(to); Directory.CreateDirectory(Path.GetDirectoryName(to));
            using(var input=new FileStream(from,FileMode.Open,FileAccess.Read,FileShare.Read))
            using(var output=new FileStream(to,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                Guard.Check(input.Length==size,"file_changed"); var buffer=new byte[262144]; long total=0;int n;
                while((n=input.Read(buffer,0,buffer.Length))>0) {
                    total=checked(total+n);Guard.Check(total<=size,"file_changed");output.Write(buffer,0,n);pulse?.Invoke();
                } Guard.Check(total==size,"file_changed");output.Flush(true);
            }
        }
    }
    public static class Archive {
        public sealed class Entry { public string Path; public long Size; public string Sha; public long Mode; }
        public static List<Entry> Descriptor(string json,long maxFiles,long maxFileBytes,long maxExpanded,long maxArchive) {
            var source=Guard.Json(json);Guard.Keys(source,new[]{"sha256","size","expandedBytes","files"});
            Guard.Sha(Guard.Text(source.GetProperty("sha256")));Guard.Number(source.GetProperty("size"),1024,maxArchive);
            long expanded=Guard.Number(source.GetProperty("expandedBytes"),0,maxExpanded);
            var list=source.GetProperty("files");Guard.Check(list.ValueKind==JsonValueKind.Array && list.GetArrayLength()>0 && list.GetArrayLength()<=maxFiles);
            var result=new List<Entry>();long total=0;
            foreach(var value in list.EnumerateArray()) {
                Guard.Keys(value,new[]{"path","size","sha256","mode"});
                var entry=new Entry { Path=Guard.Portable(Guard.Text(value.GetProperty("path"))),
                    Size=Guard.Number(value.GetProperty("size"),0,maxFileBytes),Sha=Guard.Sha(Guard.Text(value.GetProperty("sha256"))),
                    Mode=Guard.Number(value.GetProperty("mode"),420,493) };
                Guard.Check(entry.Mode==420||entry.Mode==493);total=checked(total+entry.Size);result.Add(entry);
            } Guard.Check(total==expanded && total<=maxExpanded);Guard.Unique(result.Select(e=>e.Path).ToArray());return result;
        }
        static byte[] Exact(Stream stream,int length) {
            var data=new byte[length];int done=0,n;while(done<length && (n=stream.Read(data,done,length-done))>0)done+=n;
            Guard.Check(done==length,"truncated_tar");return data;
        }
        static string Text(byte[] header,int offset,int size) {
            int end=offset;while(end<offset+size&&header[end]!=0)end++;
            Guard.Check(header.Skip(offset).Take(end-offset).All(c=>c>=32&&c<=126),"invalid_tar_text");
            return Encoding.ASCII.GetString(header,offset,end-offset);
        }
        static long Octal(byte[] header,int offset,int size) {
            string text=Encoding.ASCII.GetString(header,offset,size).Trim('\0',' ');
            Guard.Check(text.Length>0&&text.All(c=>c>='0'&&c<='7'),"invalid_tar_number");return Convert.ToInt64(text,8);
        }
        public static void Extract(string archive,string destination,string descriptor,Action pulse=null) {
            var source=Guard.Json(descriptor);var entries=Descriptor(descriptor,20000,128*1024*1024,1024L*1024*1024,1100L*1024*1024);
            Paths.NoLinks(archive);Paths.NoLinks(destination);
            Guard.Check(new FileInfo(archive).Length==source.GetProperty("size").GetInt64()&&Guard.HashFile(archive,pulse)==source.GetProperty("sha256").GetString(),"source_hash");
            Guard.Check(!Directory.Exists(destination)&&!File.Exists(destination),"destination_exists");
            Directory.CreateDirectory(destination);
            var expected=entries.ToDictionary(e=>e.Path,StringComparer.Ordinal);var seen=new HashSet<string>(StringComparer.Ordinal);
            using(var input=File.Open(archive,FileMode.Open,FileAccess.Read,FileShare.Read)) {
                bool ended=false;
                while(input.Position<input.Length) {
                    byte[] header=Exact(input,512);
                    if(header.All(c=>c==0)) { Guard.Check(Exact(input,512).All(c=>c==0),"tar_end");ended=true;break; }
                    long checksum=0;for(int i=0;i<512;i++)checksum+=(i>=148&&i<156)?32:header[i];
                    Guard.Check(checksum==Octal(header,148,8),"tar_checksum");
                    Guard.Check(Encoding.ASCII.GetString(header,257,6)=="ustar\0"&&Encoding.ASCII.GetString(header,263,2)=="00","tar_format");
                    Guard.Check((header[156]==0||header[156]==(byte)'0')&&Text(header,157,100)=="","tar_type");
                    string name=Text(header,0,100), prefix=Text(header,345,155);if(prefix.Length>0)name=prefix+"/"+name;
                    Guard.Portable(name);Guard.Check(expected.ContainsKey(name)&&seen.Add(name),"tar_inventory");
                    Entry entry=expected[name];Guard.Check(Octal(header,124,12)==entry.Size&&Octal(header,100,8)==entry.Mode,"tar_metadata");
                    string path=Paths.Inside(destination,name);Directory.CreateDirectory(Path.GetDirectoryName(path));Paths.NoLinks(path);
                    using(var output=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                    using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
                        long remaining=entry.Size;var buffer=new byte[262144];
                        while(remaining>0) { int n=input.Read(buffer,0,(int)Math.Min(remaining,buffer.Length));Guard.Check(n>0,"truncated_tar");remaining-=n;
                            hash.AppendData(buffer,0,n);output.Write(buffer,0,n);pulse?.Invoke(); }
                        Guard.Check(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()==entry.Sha,"source_file_hash");output.Flush(true);
                    }
                    int padding=(int)((512-entry.Size%512)%512);Guard.Check(Exact(input,padding).All(c=>c==0),"tar_padding");pulse?.Invoke();
                }
                Guard.Check(ended&&seen.Count==expected.Count,"tar_inventory");
                var tail=new byte[512];int length;while((length=input.Read(tail,0,tail.Length))>0)Guard.Check(tail.Take(length).All(c=>c==0),"tar_trailing");
            }
        }
        public static void VerifyTree(string directory,string descriptor,Action pulse=null) {
            var entries=Descriptor(descriptor,20000,128*1024*1024,1024L*1024*1024,1100L*1024*1024);
            var expected=entries.ToDictionary(e=>e.Path,StringComparer.Ordinal);var todo=new Stack<string>();todo.Push(directory);int count=0,dirs=0;
            Paths.NoLinks(directory);
            while(todo.Count>0)foreach(string path in Directory.EnumerateFileSystemEntries(todo.Pop())) {
                Paths.NoLinks(path); if(Directory.Exists(path)){Guard.Check(++dirs<=20000,"tree_size");todo.Push(path);continue;}
                string name=Path.GetRelativePath(directory,path).Replace(Path.DirectorySeparatorChar,'/');
                Guard.Check(expected.TryGetValue(name,out Entry entry)&&++count<=expected.Count,"tree_inventory");
                Guard.Check(new FileInfo(path).Length==entry.Size&&Guard.HashFile(path,pulse)==entry.Sha,"tree_hash");
            } Guard.Check(count==expected.Count,"tree_inventory");
        }
    }
    public sealed class RpcResponse { public string Header; public byte[] Data; }
    public static class Protocol {
        static async Task<byte[]> Exact(Stream stream,int length,CancellationToken cancel) {
            byte[] data=new byte[length];int done=0;while(done<length){int n=await stream.ReadAsync(data.AsMemory(done,length-done),cancel);
                if(n==0)throw new TransportFailure();done+=n;}return data;
        }
        public static byte[] Prefix(int value) { return new[]{(byte)(value>>24),(byte)(value>>16),(byte)(value>>8),(byte)value}; }
        static async Task Discard(Stream stream,CancellationToken cancel) { var buffer=new byte[4096];while(await stream.ReadAsync(buffer.AsMemory(),cancel)>0){} }
        public static RpcResponse Exchange(ProcessStartInfo info,string request,byte[] data,int timeoutSeconds) {
            Guard.Check(timeoutSeconds>=1&&timeoutSeconds<=120);var task=ExchangeAsync(info,request,data??Array.Empty<byte>(),timeoutSeconds);return task.GetAwaiter().GetResult();
        }
        static async Task<RpcResponse> ExchangeAsync(ProcessStartInfo info,string request,byte[] data,int timeoutSeconds) {
            byte[] header=Encoding.UTF8.GetBytes(request);Guard.Json(request);Guard.Check(header.Length<=65536&&data.Length<=1048576);
            info.UseShellExecute=false;info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;info.CreateNoWindow=true;
            using(var cancel=new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds)))
            using(var process=new Process { StartInfo=info }) {
                Task errors=null;
                try {
                    if(!process.Start())throw new TransportFailure();errors=Discard(process.StandardError.BaseStream,cancel.Token);
                    await process.StandardInput.BaseStream.WriteAsync(Prefix(header.Length),cancel.Token);
                    await process.StandardInput.BaseStream.WriteAsync(header,cancel.Token);
                    await process.StandardInput.BaseStream.WriteAsync(data,cancel.Token);process.StandardInput.Close();
                    byte[] prefix=await Exact(process.StandardOutput.BaseStream,4,cancel.Token);
                    long size=((long)prefix[0]<<24)|((long)prefix[1]<<16)|((long)prefix[2]<<8)|prefix[3];Guard.Check(size>=2&&size<=8*1024*1024,"response_size");
                    byte[] raw=await Exact(process.StandardOutput.BaseStream,(int)size,cancel.Token);
                    string text=new UTF8Encoding(false,true).GetString(raw);var value=Guard.Json(text);
                    Guard.Check(value.GetProperty("version").GetInt32()==1,"protocol_version");
                    Guard.Check(value.GetProperty("ok").ValueKind==JsonValueKind.True||value.GetProperty("ok").ValueKind==JsonValueKind.False);
                    bool ok=value.GetProperty("ok").GetBoolean();Guard.Keys(value,ok?new[]{"version","ok","dataLength","result"}:new[]{"version","ok","dataLength","error","message"});
                    int length=(int)Guard.Number(value.GetProperty("dataLength"),0,1048576);byte[] binary=await Exact(process.StandardOutput.BaseStream,length,cancel.Token);
                    byte[] extra=new byte[1];Guard.Check(await process.StandardOutput.BaseStream.ReadAsync(extra.AsMemory(),cancel.Token)==0,"response_trailing");
                    await process.WaitForExitAsync(cancel.Token);await errors;
                    Guard.Check(process.ExitCode==(ok?0:2),"ssh_exit_code");
                    if(!ok){Guard.Check(length==0);throw new RemoteFailure(Guard.Id(Guard.Text(value.GetProperty("error"))));}
                    return new RpcResponse { Header=text,Data=binary };
                } catch(RemoteFailure){throw;} catch(Rejected){throw;}
                  catch(Exception e) when(e is IOException||e is OperationCanceledException||e is System.ComponentModel.Win32Exception){throw new TransportFailure();}
                finally { try { if(!process.HasExited)process.Kill(); } catch(InvalidOperationException){} catch(System.ComponentModel.Win32Exception){} }
            }
        }
        public static ProcessStartInfo Ssh(string executable,string host,string user,int port,string knownHosts,string identity) {
            Guard.Check(Path.IsPathFullyQualified(executable)&&Path.GetExtension(executable).Equals(".exe",StringComparison.OrdinalIgnoreCase));
            Guard.Check(System.Text.RegularExpressions.Regex.IsMatch(host??"",@"\A[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}\z"));Guard.Id(user);Guard.Check(port>=1&&port<=65535);
            var info=new ProcessStartInfo(executable);string[] args={"-T","-F","NUL","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes", "-o","UpdateHostKeys=no",
                "-o","ForwardAgent=no","-o","ClearAllForwardings=yes","-o","GlobalKnownHostsFile=NUL","-o","UserKnownHostsFile="+knownHosts,
                "-o","IdentitiesOnly=yes","-o","PreferredAuthentications=publickey","-o","PasswordAuthentication=no","-o","KbdInteractiveAuthentication=no","-o","ConnectTimeout=10","-o","ServerAliveInterval=10","-o","ServerAliveCountMax=2",
                "-i",identity,"-p",port.ToString(System.Globalization.CultureInfo.InvariantCulture),user+"@"+host,"build-worker-v1"};
            foreach(string arg in args)info.ArgumentList.Add(arg);return info;
        }
    }
}
