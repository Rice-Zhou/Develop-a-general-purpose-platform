using System;
using System.IO;
class LarkNotificationFixture {
  static void Main(string[] args) {
    string root = AppDomain.CurrentDomain.BaseDirectory;
    if (args.Length > 0 && args[0] == "api") {
      Console.WriteLine("{\"code\":0,\"data\":{\"open_id\":\"ou_fixture\",\"name\":\"Local User\"}}");
      return;
    }
    if (args.Length > 1 && args[0] == "im" && args[1] == "+messages-send") {
      File.AppendAllText(Path.Combine(root, "notifications.txt"), string.Join("|", args).Replace("\n", "\\n") + "\n");
      Console.WriteLine("{\"ok\":true,\"data\":{\"message_id\":\"om_fixture\"}}");
      return;
    }
    Console.Error.WriteLine("unsupported fixture command");
    Environment.Exit(1);
  }
}
