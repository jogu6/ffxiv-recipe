using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace BuildWorker {
    public static class BoundedLog {
        public const int Limit=2*1024*1024;
        public static string Sanitize(string line) {
            line=Regex.Replace(line,@"(?i)(password|passwd|token|secret|authorization|api[_-]?key)(\s*[:=]\s*)(\S+)","$1$2[REDACTED]",RegexOptions.None,TimeSpan.FromMilliseconds(100));
            line=Regex.Replace(line,@"(?i)Bearer\s+\S+|\bgh[pousr]_[A-Za-z0-9_]+|\bgithub_pat_[A-Za-z0-9_]+|https://(?:[^/]*\.)?discord(?:app)?\.com/api/webhooks/\S+|\bAKIA[A-Z0-9]{16}","[REDACTED]",RegexOptions.None,TimeSpan.FromMilliseconds(100));
            return Regex.Replace(line,@"[\x00-\x08\x0b-\x1f\x7f]", "");
        }
        public static void Capture(Stream source,string path) {
            Paths.NoLinks(path);Directory.CreateDirectory(Path.GetDirectoryName(path));
            using(var output=new FileStream(path,FileMode.OpenOrCreate,FileAccess.Write,FileShare.Read))
            using(var reader=new StreamReader(source,new UTF8Encoding(false,false),false,4096,true)) {
                Guard.Check(output.Length<=Limit,"log_size");output.Seek(0,SeekOrigin.End);
                var line=new StringBuilder();var chars=new char[4096];bool longLine=false,privateKey=false;int count;
                Action flush=()=>{
                    string text=line.ToString();
                    if(text.Contains("-----BEGIN ")&&text.Contains("PRIVATE KEY-----"))privateKey=true;
                    string clean=(longLine||privateKey)?"[sensitive or oversized line omitted]":Sanitize(text);
                    if(text.Contains("-----END ")&&text.Contains("PRIVATE KEY-----"))privateKey=false;
                    byte[] bytes=Encoding.UTF8.GetBytes(clean+"\n");
                    if(output.Length+bytes.Length<=Limit)output.Write(bytes,0,bytes.Length);
                    line.Clear();longLine=false;
                };
                while((count=reader.Read(chars,0,chars.Length))>0) for(int i=0;i<count;i++) {
                    char c=chars[i];if(c=='\n'){flush();continue;}if(c=='\r')continue;
                    if(line.Length<4096)line.Append(c);else longLine=true;
                }
                if(line.Length>0||longLine)flush();output.Flush(true);
            }
        }
    }
}
