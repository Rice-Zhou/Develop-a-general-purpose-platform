using System;using System.IO;using System.Collections.Generic;using System.Web.Script.Serialization;
class Fixture {
 static int Main(string[] args){
  string root=AppDomain.CurrentDomain.BaseDirectory;var json=new JavaScriptSerializer();File.AppendAllText(Path.Combine(root,"calls.log"),String.Join(" ",args)+"\n");
  if(args.Length>0&&args[0]=="--version"){Console.WriteLine("codex-cli "+(File.Exists(Path.Combine(root,"version.txt"))?File.ReadAllText(Path.Combine(root,"version.txt")).Trim():"0.163.0-alpha.10.2"));return 0;}
  if(args.Length>1&&args[0]=="exec"&&args[1]=="--help"){Console.WriteLine("--sandbox --ignore-user-config --ignore-rules --json --disable --ephemeral");return 0;}
  if(args.Length==0||args[0]!="app-server")return 9;
  File.WriteAllText(Path.Combine(root,"running.pid"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
  string line;while((line=Console.ReadLine())!=null){
   var input=json.Deserialize<Dictionary<string,object>>(line);if(!input.ContainsKey("id"))continue;
   string method=(string)input["method"];File.AppendAllText(Path.Combine(root,"calls.log"),method+"\n");
   if(File.Exists(Path.Combine(root,"hang")))continue;
   object result=new {};
   if(method=="account/read")result=new {account=File.Exists(Path.Combine(root,"logged-out"))?null:(object)new {type="chatgpt",planType="pro"}};
   if(method=="model/list"){
    if(File.Exists(Path.Combine(root,"catalog-failed"))){Console.WriteLine(json.Serialize(new {id=input["id"],error=new {code=403,message="fixture private error"}}));continue;}
    var pars=(Dictionary<string,object>)input["params"];
    bool second=pars.ContainsKey("cursor");result=new {data=second?new[]{new {model="gpt-6-luna",displayName="GPT-6 Luna",hidden=false,isDefault=false}}:new[]{new {model="gpt-6.1-sol",displayName="GPT-6.1 Sol",hidden=false,isDefault=true}},nextCursor=second?null:"next"};
   }
   Console.WriteLine(json.Serialize(new {id=input["id"],result=result}));
  }return 0;
 }
}
