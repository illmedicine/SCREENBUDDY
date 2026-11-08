using System.Text.RegularExpressions;

namespace ScreenBuddy.Core;

/// <summary>
/// Replaces an installed copy of the app with a new one, file by file, with rollback.
/// <para>
/// Every file in the install folder is first moved into a backup folder inside it (a rename on the same disk, which
/// Windows allows even for a loaded exe or DLL), then the new files are copied in. If anything fails, the copied files
/// are removed and the backups moved back, so the old version still runs. The screensaver copy
/// (<c>ScreenBuddy.scr</c>) is kept and refreshed from the new exe, and the uninstaller the Setup wizard installed
/// (<c>unins000.exe</c>, <c>.dat</c>, <c>.msg</c>) is left alone so Windows' "Uninstall" keeps working after an update. User data never lives here: settings and imported
/// buddies are under %LOCALAPPDATA%\ScreenBuddy.
/// </para>
/// </summary>
public static class InstallSwapper
{
    public const string ExeName = "ScreenBuddy.exe";
    public const string ScreensaverName = "ScreenBuddy.scr";
    /// <summary>Backups go in a folder with this prefix inside the install folder; leftovers are cleaned on next start.</summary>
    public const string BackupPrefix = ".update-backup";

    /// <param name="sourceDir">The complete new app (a staged, verified release).</param>
    /// <param name="targetDir">The install folder to update.</param>
    /// <param name="beforeCopy">Test hook, called with each relative path before it is copied in.</param>
    public static void Apply(string sourceDir, string targetDir, Action<string>? beforeCopy = null)
    {
        var source = Normalize(sourceDir);
        var target = Normalize(targetDir);
        if (!File.Exists(Path.Combine(source, ExeName))) throw new InvalidUpdateException("The new version has no " + ExeName);
        if (!File.Exists(Path.Combine(target, ExeName))) throw new InvalidUpdateException("The install folder has no " + ExeName);
        if (IsSameOrInside(source, target) || IsSameOrInside(target, source))
            throw new InvalidUpdateException("The new version and the install folder overlap");

        var backup = Path.Combine(target, $"{BackupPrefix}-{DateTime.UtcNow:yyyyMMddHHmmssfff}");
        var moved = new List<string>();       // relative paths now in the backup
        var copied = new List<string>();      // relative paths written into target

        var oldFiles = Files(target).Where(f => !IsKept(f)).ToList();
        var newFiles = Files(source).Where(f => !IsKept(f)).ToList();

        try
        {
            foreach (var rel in oldFiles)
            {
                var to = Path.Combine(backup, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                File.Move(Path.Combine(target, rel), to);
                moved.Add(rel);
            }
            foreach (var rel in newFiles)
            {
                beforeCopy?.Invoke(rel);
                var to = Path.Combine(target, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                File.Copy(Path.Combine(source, rel), to, overwrite: true);
                copied.Add(rel);
            }
        }
        catch
        {
            foreach (var rel in copied) TryDelete(Path.Combine(target, rel));
            foreach (var rel in moved)
            {
                try { File.Move(Path.Combine(backup, rel), Path.Combine(target, rel), overwrite: true); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
            }
            RemoveEmptyDirs(target);
            TryDeleteDir(backup);
            throw;
        }

        // The new version is in place. Refresh the screensaver copy, then tidy up (best effort: a file that's still in
        // use stays in the backup folder and is removed by CleanUp next time).
        var scr = Path.Combine(target, ScreensaverName);
        if (File.Exists(scr))
        {
            try { File.Copy(Path.Combine(target, ExeName), scr, overwrite: true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        RemoveEmptyDirs(target);
        TryDeleteDir(backup);
    }

    private static readonly Regex Uninstaller = new(@"^unins\d{3}\.(exe|dat|msg)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Files an update never moves or replaces: the screensaver copy (refreshed separately) and the Setup uninstaller.</summary>
    private static bool IsKept(string rel) =>
        rel.Equals(ScreensaverName, StringComparison.OrdinalIgnoreCase) || Uninstaller.IsMatch(rel);

    /// <summary>Removes backup folders left by earlier updates.</summary>
    public static void CleanUp(string installDir)
    {
        try
        {
            foreach (var dir in Directory.GetDirectories(installDir, BackupPrefix + "*")) TryDeleteDir(dir);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>Relative paths of every file under <paramref name="root"/>, skipping old backup folders.</summary>
    private static List<string> Files(string root) =>
        Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(root, f))
            .Where(rel => !rel.StartsWith(BackupPrefix, StringComparison.OrdinalIgnoreCase))
            .ToList();

    private static string Normalize(string dir) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));

    private static bool IsSameOrInside(string dir, string parent) =>
        dir.Equals(parent, StringComparison.OrdinalIgnoreCase) ||
        dir.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    private static void RemoveEmptyDirs(string root)
    {
        foreach (var dir in Directory.GetDirectories(root, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
        {
            try { if (!Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
    }

    private static void TryDelete(string file)
    {
        try { File.Delete(file); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private static void TryDeleteDir(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
