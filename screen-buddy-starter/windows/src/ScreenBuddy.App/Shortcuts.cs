using System;
using System.IO;
using System.Runtime.InteropServices;

namespace ScreenBuddy.App;

/// <summary>
/// "Screen Buddy" shortcuts on the desktop and in the Start menu, so the app can be started again after "Exit".
/// Per-user folders only; no admin rights needed.
/// </summary>
internal static class Shortcuts
{
    private const string FileName = "Screen Buddy.lnk";

    public static string DesktopPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), FileName);
    public static string StartMenuPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), FileName);

    public static bool HasDesktop => File.Exists(DesktopPath);

    private static string? Exe =>
        Environment.ProcessPath is { } p && p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? p : null;

    /// <summary>Creates or rewrites a shortcut to the running exe. Returns false if Windows wouldn't let us.</summary>
    public static bool Create(string path)
    {
        if (Exe is not { } exe) return false;
        object? shell = null, link = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var type = Type.GetTypeFromProgID("WScript.Shell");
            if (type is null) return false;
            shell = Activator.CreateInstance(type);
            dynamic s = shell!;
            link = s.CreateShortcut(path);
            dynamic l = link!;
            l.TargetPath = exe;
            l.WorkingDirectory = Path.GetDirectoryName(exe);
            l.IconLocation = exe + ",0";
            l.Description = "Screen Buddy: your animated desktop buddy";
            l.Save();
            return true;
        }
        catch (Exception e) when (e is COMException or IOException or UnauthorizedAccessException or ArgumentException
                                     or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
        {
            Program.Log(e);
            return false;
        }
        finally
        {
            if (link is not null && Marshal.IsComObject(link)) Marshal.FinalReleaseComObject(link);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    public static void Remove(string path)
    {
        try { File.Delete(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>
    /// For an installed release: on the first run, add both shortcuts; on later runs, re-point any that still exist at
    /// this exe (in case the folder was moved). A shortcut the user deleted stays deleted.
    /// </summary>
    public static void Ensure(bool firstRun)
    {
        foreach (var path in new[] { DesktopPath, StartMenuPath })
            if (firstRun || File.Exists(path)) Create(path);
    }
}
