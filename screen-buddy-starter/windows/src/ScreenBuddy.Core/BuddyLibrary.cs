using System.IO.Compression;
using System.Text;

namespace ScreenBuddy.Core;

/// <summary>Where a buddy's files are read from.</summary>
public interface IBuddySource
{
    Stream Open(string fileName);
}

/// <summary>A folder holding manifest.json, face.webp and the strips. File names were validated by the manifest.</summary>
public sealed class DirectorySource(string directory) : IBuddySource
{
    public Stream Open(string fileName) => File.OpenRead(Path.Combine(directory, fileName));
}

public sealed record Buddy(BuddyManifest Manifest, IBuddySource Source, bool Bundled)
{
    public string Id => Manifest.Id;
}

/// <summary>
/// The user's library: sample buddies next to the exe (<c>buddies/&lt;id&gt;/</c>) plus buddies imported from a
/// buddy.zip, which are unpacked under the user's app data folder.
/// </summary>
public sealed class BuddyLibrary(string bundledRoot, string userRoot)
{
    public const int MaxFiles = 40;
    public const int MaxFileBytes = 8 * 1024 * 1024;
    public const long MaxTotalBytes = 40L * 1024 * 1024;

    private volatile IReadOnlySet<string> _hidden = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>
    /// Ids the website's admin hid (Firestore buddies/{id}.hidden). <see cref="List"/> and <see cref="Find"/> leave them
    /// out, built-in buddies included, so a hidden character disappears from every menu, the tray and the screensaver.
    /// </summary>
    public IReadOnlySet<string> Hidden
    {
        get => _hidden;
        set => _hidden = value ?? new HashSet<string>(StringComparer.Ordinal);
    }

    public IReadOnlyList<Buddy> List()
    {
        var hidden = _hidden;
        var all = new Dictionary<string, Buddy>(StringComparer.Ordinal);
        foreach (var (dir, bundled) in Directories(bundledRoot).Select(d => (d, true)).Concat(Directories(userRoot).Select(d => (d, false))))
        {
            try
            {
                var m = BuddyManifest.Parse(File.ReadAllText(Path.Combine(dir, BuddyManifest.FileName), Encoding.UTF8));
                if (hidden.Contains(m.Id)) continue;
                all.TryAdd(m.Id, new Buddy(m, new DirectorySource(dir), bundled));    // a built-in id always wins
            }
            catch (Exception e) when (e is InvalidBuddyException or IOException or UnauthorizedAccessException) { /* skip a broken folder */ }
        }
        return all.Values.ToList();
    }

    /// <summary>The buddy with <paramref name="id"/>, or the first one in the library if that id is gone (or null).</summary>
    public Buddy? Find(string? id)
    {
        var all = List();
        return all.FirstOrDefault(b => b.Id == id) ?? all.FirstOrDefault();
    }

    /// <summary>
    /// Imports a buddy.zip. The archive is untrusted: only flat, size-limited files are accepted, every file the manifest
    /// names must be present and be a WebP image, the id must not clash with a built-in buddy, and nothing is kept
    /// unless the whole package is valid.
    /// </summary>
    public Buddy ImportZip(Stream zip)
    {
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        long total = 0;
        try
        {
            using var archive = new ZipArchive(zip, ZipArchiveMode.Read, leaveOpen: true);
            foreach (var entry in archive.Entries)
            {
                var name = entry.FullName;
                if (name.EndsWith('/')) continue;                                     // a folder entry
                if (name.Contains('/') || name.Contains('\\') || name.StartsWith('.'))
                    throw new InvalidBuddyException($"Unexpected path '{name}' in zip");
                if (files.ContainsKey(name)) throw new InvalidBuddyException($"Duplicate file '{name}' in zip");
                if (files.Count >= MaxFiles) throw new InvalidBuddyException("Too many files in zip");
                if (entry.Length > MaxFileBytes) throw new InvalidBuddyException("A file in the zip is too large");
                var bytes = ReadLimited(entry.Open(), MaxFileBytes);
                total += bytes.Length;
                if (total > MaxTotalBytes) throw new InvalidBuddyException("Zip is too large");
                files[name] = bytes;
            }
        }
        catch (InvalidDataException) { throw new InvalidBuddyException("That isn't a valid zip file"); }

        if (!files.TryGetValue(BuddyManifest.FileName, out var raw)) throw new InvalidBuddyException($"No {BuddyManifest.FileName} in zip");
        var manifest = BuddyManifest.Parse(Encoding.UTF8.GetString(raw));
        if (Directories(bundledRoot).Any(d => string.Equals(Path.GetFileName(d), manifest.Id, StringComparison.Ordinal)) ||
            List().Any(b => b.Bundled && b.Id == manifest.Id))
            throw new InvalidBuddyException($"A built-in buddy already uses the id '{manifest.Id}'. Change \"id\" in manifest.json.");

        var needed = manifest.Clips.Values.Select(c => c.Src).Append(manifest.Face).ToHashSet(StringComparer.Ordinal);
        foreach (var name in needed)
        {
            if (!files.TryGetValue(name, out var bytes)) throw new InvalidBuddyException($"Missing file {name}");
            if (!IsWebp(bytes)) throw new InvalidBuddyException($"{name} is not a WebP image");
        }

        Directory.CreateDirectory(userRoot);
        var dest = Path.Combine(userRoot, manifest.Id);
        var tmp = Path.Combine(userRoot, "." + manifest.Id + ".tmp");
        if (Directory.Exists(tmp)) Directory.Delete(tmp, recursive: true);
        Directory.CreateDirectory(tmp);
        foreach (var name in needed) File.WriteAllBytes(Path.Combine(tmp, name), files[name]);
        File.WriteAllBytes(Path.Combine(tmp, BuddyManifest.FileName), raw);
        if (Directory.Exists(dest)) Directory.Delete(dest, recursive: true);
        Directory.Move(tmp, dest);
        return new Buddy(manifest, new DirectorySource(dest), Bundled: false);
    }

    /// <summary>Removes an imported buddy. Built-in buddies can't be removed.</summary>
    public void Delete(Buddy buddy)
    {
        if (buddy.Bundled) return;
        var dir = Path.Combine(userRoot, buddy.Id);
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private static IEnumerable<string> Directories(string root) =>
        Directory.Exists(root)
            ? Directory.EnumerateDirectories(root).Where(d => !Path.GetFileName(d).StartsWith('.')).OrderBy(d => d, StringComparer.Ordinal)
            : [];

    private static byte[] ReadLimited(Stream s, int limit)
    {
        using (s)
        {
            var ms = new MemoryStream();
            var buf = new byte[16 * 1024];
            int n;
            while ((n = s.Read(buf, 0, buf.Length)) > 0)
            {
                ms.Write(buf, 0, n);
                if (ms.Length > limit) throw new InvalidBuddyException("A file in the zip is too large");
            }
            return ms.ToArray();
        }
    }

    private static bool IsWebp(byte[] b) =>
        b.Length > 12 && Encoding.ASCII.GetString(b, 0, 4) == "RIFF" && Encoding.ASCII.GetString(b, 8, 4) == "WEBP";
}
