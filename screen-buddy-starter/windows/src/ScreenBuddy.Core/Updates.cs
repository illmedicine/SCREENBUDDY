using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ScreenBuddy.Core;

/// <summary>An update, release list or channel file that can't be trusted. The app treats it as "no update".</summary>
public sealed class InvalidUpdateException(string message) : Exception(message);

/// <summary>
/// A release version: up to four numbers (<c>1.2.3</c>, <c>1.2.3.4</c>) with an optional SemVer pre-release tag
/// (<c>1.3.0-beta.2</c>). A leading <c>v</c> and any <c>+build</c> suffix are ignored. Missing numbers count as 0, so
/// <c>1.2</c> equals <c>1.2.0</c>, and a pre-release sorts before its release.
/// </summary>
public sealed class AppVersion : IComparable<AppVersion>, IEquatable<AppVersion>
{
    public int Major { get; }
    public int Minor { get; }
    public int Patch { get; }
    public int Revision { get; }
    /// <summary>The part after '-', or null for a full release.</summary>
    public string? Prerelease { get; }

    private AppVersion(int major, int minor, int patch, int revision, string? pre)
    {
        Major = major; Minor = minor; Patch = patch; Revision = revision; Prerelease = pre;
    }

    private static readonly Regex PreTag = new("^[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*$", RegexOptions.CultureInvariant);

    public static bool TryParse(string? text, out AppVersion version)
    {
        version = null!;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var s = text.Trim();
        if (s[0] is 'v' or 'V') s = s[1..];
        var plus = s.IndexOf('+');
        if (plus >= 0) s = s[..plus];
        string? pre = null;
        var dash = s.IndexOf('-');
        if (dash >= 0)
        {
            pre = s[(dash + 1)..];
            s = s[..dash];
            if (!PreTag.IsMatch(pre)) return false;
        }
        var parts = s.Split('.');
        if (parts.Length is < 1 or > 4) return false;
        var n = new int[4];
        for (var i = 0; i < parts.Length; i++)
            if (!int.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out n[i])) return false;
        version = new AppVersion(n[0], n[1], n[2], n[3], pre);
        return true;
    }

    public static AppVersion Parse(string? text) =>
        TryParse(text, out var v) ? v : throw new InvalidUpdateException($"'{text}' is not a version");

    public int CompareTo(AppVersion? other)
    {
        if (other is null) return 1;
        foreach (var c in new[] { Major.CompareTo(other.Major), Minor.CompareTo(other.Minor), Patch.CompareTo(other.Patch), Revision.CompareTo(other.Revision) })
            if (c != 0) return c;
        if (Prerelease is null) return other.Prerelease is null ? 0 : 1;      // 1.0.0 > 1.0.0-beta
        if (other.Prerelease is null) return -1;
        return ComparePrerelease(Prerelease, other.Prerelease);
    }

    /// <summary>SemVer rules: dot-separated identifiers, numbers compare as numbers and sort before words.</summary>
    private static int ComparePrerelease(string a, string b)
    {
        var x = a.Split('.');
        var y = b.Split('.');
        for (var i = 0; i < Math.Min(x.Length, y.Length); i++)
        {
            var xn = long.TryParse(x[i], NumberStyles.None, CultureInfo.InvariantCulture, out var xi);
            var yn = long.TryParse(y[i], NumberStyles.None, CultureInfo.InvariantCulture, out var yi);
            var c = (xn, yn) switch
            {
                (true, true) => xi.CompareTo(yi),
                (true, false) => -1,
                (false, true) => 1,
                _ => string.CompareOrdinal(x[i], y[i]),
            };
            if (c != 0) return Math.Sign(c);
        }
        return x.Length.CompareTo(y.Length);
    }

    public bool Equals(AppVersion? other) => other is not null && CompareTo(other) == 0;
    public override bool Equals(object? obj) => obj is AppVersion v && Equals(v);
    public override int GetHashCode() => HashCode.Combine(Major, Minor, Patch, Revision, Prerelease);
    public static bool operator >(AppVersion a, AppVersion b) => a.CompareTo(b) > 0;
    public static bool operator <(AppVersion a, AppVersion b) => a.CompareTo(b) < 0;
    public static bool operator >=(AppVersion a, AppVersion b) => a.CompareTo(b) >= 0;
    public static bool operator <=(AppVersion a, AppVersion b) => a.CompareTo(b) <= 0;

    public override string ToString() =>
        $"{Major}.{Minor}.{Patch}" + (Revision != 0 ? $".{Revision}" : "") + (Prerelease is null ? "" : "-" + Prerelease);
}

/// <summary>
/// <c>update.json</c>, published as an asset of every desktop release:
/// <c>{"version": "1.2.0", "url": "https://github.com/.../ScreenBuddy-win-x64-1.2.0.zip", "sha256": "…", "size": 123, "notes": "…"}</c>.
/// </summary>
public sealed record UpdateManifest(AppVersion Version, Uri Url, string Sha256, long Size, string? Notes)
{
    public const string FileName = "update.json";
    /// <summary>A sanity cap: the self-contained build is well under this.</summary>
    public const long MaxSize = 512L * 1024 * 1024;

    private static readonly Regex Hex64 = new("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

    public static UpdateManifest Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new InvalidUpdateException("update.json is not an object");

            var version = AppVersion.Parse(RequiredString(root, "version"));
            var url = GitHubReleases.TrustedDownloadUrl(RequiredString(root, "url"));
            var sha = RequiredString(root, "sha256").Trim().ToLowerInvariant();
            if (!Hex64.IsMatch(sha)) throw new InvalidUpdateException("sha256 must be 64 hex characters");
            if (!root.TryGetProperty("size", out var sizeEl) || sizeEl.ValueKind != JsonValueKind.Number || !sizeEl.TryGetInt64(out var size))
                throw new InvalidUpdateException("size is missing");
            if (size <= 0 || size > MaxSize) throw new InvalidUpdateException("size is out of range");
            string? notes = root.TryGetProperty("notes", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
            return new UpdateManifest(version, url, sha, size, notes);
        }
        catch (JsonException e) { throw new InvalidUpdateException("update.json is not valid JSON: " + e.Message); }
    }

    private static string RequiredString(JsonElement o, string name) =>
        o.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String && el.GetString() is { Length: > 0 } s
            ? s
            : throw new InvalidUpdateException($"{name} is missing");

    /// <summary>Lower-case hex SHA-256 of the stream's remaining bytes.</summary>
    public static string Sha256Hex(Stream s) => Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant();
}

/// <summary>
/// <c>release.json</c> next to the exe: which GitHub repository this build updates from. Release builds get it from the
/// release workflow; a copy without it (a dev build) never updates itself.
/// <c>{"repo": "owner/name", "tagPrefix": "windows-v"}</c>
/// </summary>
public sealed record ReleaseChannel(string Repo, string TagPrefix)
{
    public const string FileName = "release.json";

    private static readonly Regex RepoPattern = new("^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$", RegexOptions.CultureInvariant);
    private static readonly Regex PrefixPattern = new("^[A-Za-z0-9._-]{0,40}$", RegexOptions.CultureInvariant);

    public Uri ReleasesApi => new($"https://api.github.com/repos/{Repo}/releases?per_page=30");

    public static ReleaseChannel Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new InvalidUpdateException("release.json is not an object");
            var repo = root.TryGetProperty("repo", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() ?? "" : "";
            var prefix = root.TryGetProperty("tagPrefix", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() ?? "" : "v";
            if (!RepoPattern.IsMatch(repo)) throw new InvalidUpdateException("release.json: repo must look like owner/name");
            if (!PrefixPattern.IsMatch(prefix)) throw new InvalidUpdateException("release.json: bad tagPrefix");
            return new ReleaseChannel(repo, prefix);
        }
        catch (JsonException e) { throw new InvalidUpdateException("release.json is not valid JSON: " + e.Message); }
    }

    /// <summary>Reads release.json from <paramref name="installDir"/>, or null if it's missing or unreadable.</summary>
    public static ReleaseChannel? Load(string installDir)
    {
        try { return Parse(File.ReadAllText(Path.Combine(installDir, FileName))); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidUpdateException) { return null; }
    }
}

/// <summary>The newest desktop release found on GitHub, and where its update.json is.</summary>
public sealed record ReleaseCandidate(string Tag, AppVersion Version, Uri ManifestUrl);

/// <summary>Reads the GitHub "list releases" API response.</summary>
public static class GitHubReleases
{
    /// <summary>
    /// The highest-versioned published release whose tag is <c>{prefix}{version}</c> and which has an update.json asset.
    /// Drafts, pre-releases and other platforms' releases (any other tag) are skipped. Null if there's none.
    /// </summary>
    public static ReleaseCandidate? FindLatest(string json, ReleaseChannel channel)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) throw new InvalidUpdateException("release list is not an array");
            ReleaseCandidate? best = null;
            foreach (var rel in doc.RootElement.EnumerateArray())
            {
                if (rel.ValueKind != JsonValueKind.Object) continue;
                if (Bool(rel, "draft") || Bool(rel, "prerelease")) continue;
                if (!rel.TryGetProperty("tag_name", out var t) || t.ValueKind != JsonValueKind.String) continue;
                var tag = t.GetString()!;
                if (!tag.StartsWith(channel.TagPrefix, StringComparison.Ordinal)) continue;
                if (!AppVersion.TryParse(tag[channel.TagPrefix.Length..], out var version) || version.Prerelease is not null) continue;
                if (best is not null && version <= best.Version) continue;
                if (ManifestAsset(rel) is { } url) best = new ReleaseCandidate(tag, version, url);
            }
            return best;
        }
        catch (JsonException e) { throw new InvalidUpdateException("release list is not valid JSON: " + e.Message); }
    }

    private static Uri? ManifestAsset(JsonElement release)
    {
        if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) return null;
        foreach (var a in assets.EnumerateArray())
        {
            if (a.ValueKind != JsonValueKind.Object) continue;
            if (!a.TryGetProperty("name", out var n) || n.ValueKind != JsonValueKind.String || n.GetString() != UpdateManifest.FileName) continue;
            if (!a.TryGetProperty("browser_download_url", out var u) || u.ValueKind != JsonValueKind.String) continue;
            try { return TrustedDownloadUrl(u.GetString()!); }
            catch (InvalidUpdateException) { return null; }
        }
        return null;
    }

    private static bool Bool(JsonElement o, string name) =>
        o.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.True;

    /// <summary>Only https links to github.com (release downloads) are followed.</summary>
    public static Uri TrustedDownloadUrl(string text)
    {
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) || !uri.IsDefaultPort || uri.UserInfo.Length > 0)
            throw new InvalidUpdateException("download links must be https://github.com/...");
        return uri;
    }
}

/// <summary>Install and update state, kept in its own file so it doesn't depend on the settings format.</summary>
public sealed record UpdatePreferences
{
    public bool AutoUpdate { get; init; } = true;
    /// <summary>The first run of a release build has added its desktop and Start menu shortcuts.</summary>
    public bool ShortcutsCreated { get; init; }
}

public sealed class UpdatePreferencesStore(string path)
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public UpdatePreferences Load()
    {
        try { return JsonSerializer.Deserialize<UpdatePreferences>(File.ReadAllText(path)) ?? new UpdatePreferences(); }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException or NotSupportedException)
        {
            return new UpdatePreferences();
        }
    }

    public void Save(UpdatePreferences prefs)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(prefs, Options));
            File.Move(tmp, path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
