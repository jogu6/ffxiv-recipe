using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Threading.Tasks;

namespace BuildWorker {
    public sealed class JobTree : IDisposable {
        const uint KILL_ON_JOB_CLOSE=0x2000, JOB_MEMORY=0x200;
        const uint CREATE_SUSPENDED=0x4, CREATE_UNICODE_ENVIRONMENT=0x400, EXTENDED_STARTUPINFO_PRESENT=0x80000, CREATE_NO_WINDOW=0x8000000;
        const long PROC_THREAD_ATTRIBUTE_JOB_LIST=0x0002000D;
        SafeFileHandle job; SafeFileHandle process; Task logPump;
        [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long ProcessTime,JobTime;public uint Flags;public UIntPtr MinWorking,MaxWorking;public uint ActiveLimit;public UIntPtr Affinity;public uint Priority,Scheduling; }
        [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct LIMIT { public BASIC_LIMIT Basic;public IO_COUNTERS Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
        [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long User,Kernel,PeriodUser,PeriodKernel;public uint Faults,Total,Active,Terminated; }
        [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public uint cb;public IntPtr reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public ushort show,reserved2;public IntPtr reservedPtr,input,output,error; }
        [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO Startup;public IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFO { public IntPtr Process,Thread;public uint Pid,Tid; }
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateJobObjectW(IntPtr attributes,string name);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(SafeFileHandle job,int info,ref LIMIT limit,uint size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(SafeFileHandle job,int info,out ACCOUNTING account,uint size,IntPtr returned);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(SafeFileHandle job,int info,out LIMIT limit,uint size,IntPtr returned);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(SafeFileHandle job,uint code);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFO info);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(SafeFileHandle thread);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(SafeFileHandle process,out uint code);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(SafeFileHandle process,uint code);
        [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int Length;public IntPtr Descriptor;[MarshalAs(UnmanagedType.Bool)]public bool Inherit; }
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out SafeFileHandle read,out SafeFileHandle write,ref SECURITY_ATTRIBUTES attributes,uint size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(SafeFileHandle handle,uint mask,uint flags);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,ref SECURITY_ATTRIBUTES attributes,uint creation,uint flags,IntPtr template);
        static void Native(bool ok) { if(!ok)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
        public JobTree(long memoryBytes) {
            if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException();
            Guard.Check(memoryBytes==0||(memoryBytes>=256*1024*1024&&memoryBytes<=64L*1024*1024*1024));
            job=CreateJobObjectW(IntPtr.Zero,null);Native(!job.IsInvalid);
            try { var limit=new LIMIT {Basic=new BASIC_LIMIT{Flags=KILL_ON_JOB_CLOSE|(memoryBytes==0?0:JOB_MEMORY)},JobMemory=(UIntPtr)(ulong)memoryBytes};Native(SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf<LIMIT>())); }
            catch {job.Dispose();throw;}
        }
        public long MemoryLimitBytes {get {Native(QueryInformationJobObject(job,9,out LIMIT limit,(uint)Marshal.SizeOf<LIMIT>(),IntPtr.Zero));return (limit.Basic.Flags&JOB_MEMORY)==0?0:(long)limit.JobMemory.ToUInt64();}}
        public static string Quote(string value) {
            Guard.Check(value!=null&&!value.Contains('\0'));var b=new StringBuilder("\"");int slashes=0;
            foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1).Append('"');slashes=0;continue;}b.Append('\\',slashes).Append(c);slashes=0;}
            b.Append('\\',slashes*2).Append('"');return b.ToString();
        }
        public static string EnvironmentBlock(IDictionary<string,string> values) {
            var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var p in values)Guard.Check(!string.IsNullOrEmpty(p.Key)&&!p.Key.Contains('=')&&!p.Key.Contains('\0')&&p.Value!=null&&!p.Value.Contains('\0')&&seen.Add(p.Key),"duplicate_environment");
            return string.Join("\0",values.OrderBy(p=>p.Key,StringComparer.OrdinalIgnoreCase).Select(p=>p.Key+"="+p.Value))+"\0\0";
        }
        public void Start(string executable,string[] args,string cwd,IDictionary<string,string> environment) { StartInternal(executable,args,cwd,environment,null); }
        public void StartLogged(string executable,string[] args,string cwd,IDictionary<string,string> environment,string logPath) { Paths.NoLinks(logPath);StartInternal(executable,args,cwd,environment,logPath); }
        void StartInternal(string executable,string[] args,string cwd,IDictionary<string,string> environment,string logPath) {
            Guard.Check(job!=null&&!job.IsClosed&&ActiveProcesses==0,"job_not_idle");
            Guard.Check(Path.IsPathFullyQualified(executable)&&Path.GetExtension(executable).Equals(".exe",StringComparison.OrdinalIgnoreCase)&&File.Exists(executable));Paths.NoLinks(cwd);
            string command=Quote(executable)+" "+string.Join(" ",args.Select(Quote));Guard.Check(command.Length<32767);
            IntPtr size=IntPtr.Zero,list=IntPtr.Zero,handles=IntPtr.Zero,env=IntPtr.Zero,inheritList=IntPtr.Zero;bool initialized=false;
            SafeFileHandle read=null,write=null,input=null;
            PROCESS_INFO pi=new PROCESS_INFO();SafeFileHandle thread=null;bool resumed=false;
            try {
                int attributeCount=logPath==null?1:2;
                InitializeProcThreadAttributeList(IntPtr.Zero,attributeCount,0,ref size);Guard.Check(size!=IntPtr.Zero,"attribute_size");list=Marshal.AllocHGlobal(size);
                Native(InitializeProcThreadAttributeList(list,attributeCount,0,ref size));initialized=true;handles=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(handles,job.DangerousGetHandle());
                Native(UpdateProcThreadAttribute(list,0,(IntPtr)PROC_THREAD_ATTRIBUTE_JOB_LIST,handles,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero));
                env=Marshal.StringToHGlobalUni(EnvironmentBlock(environment));
                var si=new STARTUPINFOEX{Startup=new STARTUPINFO{cb=(uint)Marshal.SizeOf<STARTUPINFOEX>()},Attributes=list};
                if(logPath!=null) {
                    var security=new SECURITY_ATTRIBUTES {Length=Marshal.SizeOf<SECURITY_ATTRIBUTES>(),Inherit=true};
                    Native(CreatePipe(out read,out write,ref security,65536));Native(SetHandleInformation(read,1,0));
                    input=CreateFileW("NUL",0x80000000,3,ref security,3,0x80,IntPtr.Zero);Native(!input.IsInvalid);
                    inheritList=Marshal.AllocHGlobal(IntPtr.Size*2);Marshal.WriteIntPtr(inheritList,0,write.DangerousGetHandle());Marshal.WriteIntPtr(inheritList,IntPtr.Size,input.DangerousGetHandle());
                    Native(UpdateProcThreadAttribute(list,0,(IntPtr)0x00020002,inheritList,(IntPtr)(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
                    si.Startup.flags=0x100;si.Startup.input=input.DangerousGetHandle();si.Startup.output=write.DangerousGetHandle();si.Startup.error=write.DangerousGetHandle();
                }
                // Atomic assignment at creation avoids an orphan window before AssignProcessToJobObject.
                Native(CreateProcessW(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,logPath!=null,
                    CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,env,cwd,ref si,out pi));
                process?.Dispose();process=new SafeFileHandle(pi.Process,true);thread=new SafeFileHandle(pi.Thread,true);
                if(logPath!=null) {
                    var capturedRead=read;read=null;
                    logPump=Task.Run(()=>{using(var stream=new FileStream(capturedRead,FileAccess.Read,4096,false))BoundedLog.Capture(stream,logPath);});
                } else logPump=null;
                Native(ResumeThread(thread)!=uint.MaxValue);resumed=true;
            } finally {
                if(!resumed&&process!=null&&!process.IsInvalid&&!process.IsClosed)TerminateProcess(process,125);
                write?.Dispose();input?.Dispose();read?.Dispose();
                thread?.Dispose();if(initialized)DeleteProcThreadAttributeList(list);
                if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(env!=IntPtr.Zero)Marshal.FreeHGlobal(env);if(inheritList!=IntPtr.Zero)Marshal.FreeHGlobal(inheritList);
            }
        }
        public uint ActiveProcesses { get { Native(QueryInformationJobObject(job,1,out ACCOUNTING a,(uint)Marshal.SizeOf<ACCOUNTING>(),IntPtr.Zero));return a.Active; } }
        public bool Completed { get { if(process==null||ActiveProcesses!=0)return false;if(logPump!=null){if(!logPump.IsCompleted)return false;logPump.GetAwaiter().GetResult();}return true; } }
        public uint ExitCode { get { Guard.Check(Completed);Native(GetExitCodeProcess(process,out uint code));return code; } }
        public void Dispose() {
            if(job==null||job.IsClosed)return;
            try {
                Native(TerminateJobObject(job,125));var timer=System.Diagnostics.Stopwatch.StartNew();
                while(ActiveProcesses!=0&&timer.ElapsedMilliseconds<10000)System.Threading.Thread.Sleep(25);
                Guard.Check(ActiveProcesses==0,"termination_unconfirmed");
                if(logPump!=null) { try { Guard.Check(logPump.Wait(5000),"log_drain_unconfirmed"); } catch(AggregateException) { throw new Rejected("log_capture_failed"); } }
            } finally {process?.Dispose();job.Dispose();}
        }
    }
}
