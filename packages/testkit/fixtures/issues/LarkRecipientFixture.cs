using System;
using System.IO;
using System.Text;
class LarkRecipientFixture {
  static void Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false);
    string root=AppDomain.CurrentDomain.BaseDirectory;
    File.AppendAllText(Path.Combine(root,"cli-calls.txt"),string.Join("|",args).Replace("\n","\\n")+"\n");
    if(args.Length>1 && args[0]=="contact" && args[1]=="+search-user") {
      string query=Array.IndexOf(args,"--query")>=0?args[Array.IndexOf(args,"--query")+1]:"";
      if(query=="授权失效" || File.Exists(Path.Combine(root,"user-auth-expired.flag"))) {
        Console.Error.WriteLine("{\"ok\":false,\"identity\":\"user\",\"error\":{\"type\":\"authentication\",\"subtype\":\"token_missing\",\"message\":\"need_user_authorization\"}}");
        Environment.Exit(3);return;
      }
      Console.WriteLine("{\"ok\":true,\"data\":{\"users\":[{\"open_id\":\"ou_one\",\"localized_name\":\"周贺棋\",\"department\":\"部门一\"},{\"open_id\":\"ou_two\",\"localized_name\":\"周贺棋\",\"department\":\"部门二\"}],\"has_more\":false}}");return;
    }
    if(args.Length>0 && args[0]=="api") {
      Console.Error.WriteLine("{\"ok\":false,\"identity\":\"user\",\"error\":{\"type\":\"authentication\",\"subtype\":\"token_missing\"}}");
      Environment.Exit(3);return;
    }
    if(args.Length>1 && args[0]=="im" && args[1]=="+messages-send") {
      File.AppendAllText(Path.Combine(root,"notifications.txt"),string.Join("|",args).Replace("\n","\\n")+"\n");
      Console.WriteLine("{\"ok\":true,\"data\":{\"message_id\":\"om_fixture\"}}");return;
    }
    Console.Error.WriteLine("unsupported fixture command");Environment.Exit(1);
  }
}
