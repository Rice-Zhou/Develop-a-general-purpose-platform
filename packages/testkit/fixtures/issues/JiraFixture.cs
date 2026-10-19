using System;
using System.IO;
using System.Text;
// Test-only native executable. No network or real credentials.
public class JiraFixture {
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    string root = AppDomain.CurrentDomain.BaseDirectory;
    File.AppendAllText(Path.Combine(root, "calls.txt"), String.Join(" ", args) + "\n");
    if (args.Length == 0) return 2;
    if (args[0] == "serverinfo") { Console.WriteLine("Base URL: " + File.ReadAllText(Path.Combine(root, "host.txt"))); return 0; }
    if (args.Length < 2 || args[0] != "issue") return 3;
    if (args[1] == "view") { Console.WriteLine(File.ReadAllText(Path.Combine(root, "issue.json"))); return 0; }
    if (args[1] == "list") { Console.WriteLine(Array.IndexOf(args, "0:100") >= 0 ? "[" + File.ReadAllText(Path.Combine(root, "issue.json")) + "]" : "[]"); return 0; }
    return 4;
  }
}
