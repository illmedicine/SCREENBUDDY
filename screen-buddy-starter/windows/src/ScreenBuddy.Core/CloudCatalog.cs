using System.Text.Json;

namespace ScreenBuddy.Core;

/// <summary>
/// Shared buddies added from the website's admin page after this release was built. Firestore lists them
/// (catalog/{id}: Storage prefix and version, public to read) and each one's buddy.zip lives in Cloud Storage. The app
/// installs new or updated ones through <see cref="BuddyLibrary.ImportZip"/>, so they get the same checks as any import.
/// </summary>
public static class CloudCatalog
{
    public const string Project = "screen-buddy-f968b";
    public const string Bucket = "screen-buddy-f968b.firebasestorage.app";
    public const string ApiKey = "AIzaSyBQi0TVrDIWQ4hclgFox9SMzRsGQSwC8CU";   // the website's public web key

    public sealed record Entry(string Id, string Prefix, long Version);

    public static string ListUrl(string collection) =>
        $"https://firestore.googleapis.com/v1/projects/{Project}/databases/(default)/documents/{collection}?pageSize=300&key={ApiKey}";

    /// <summary>A public file in Cloud Storage by its path in the bucket.</summary>
    public static string FileUrl(string path) =>
        $"https://firebasestorage.googleapis.com/v0/b/{Bucket}/o/{Uri.EscapeDataString(path)}?alt=media";

    /// <summary>The catalog entries in a Firestore REST list response. Anything malformed is skipped.</summary>
    public static IReadOnlyList<Entry> Parse(string json)
    {
        var list = new List<Entry>();
        foreach (var (id, fields) in Documents(json))
        {
            var prefix = Str(fields, "prefix");
            if (prefix is null || !prefix.StartsWith("buddies/", StringComparison.Ordinal) || prefix.Contains("..")) continue;
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-z0-9][a-z0-9_-]{0,63}$")) continue;
            list.Add(new Entry(id, prefix, Int(fields, "version")));
        }
        return list;
    }

    /// <summary>Ids the admin hid (buddies/{id}.hidden == true).</summary>
    public static ISet<string> ParseHidden(string json) =>
        Documents(json).Where(d => d.Fields.TryGetProperty("hidden", out var h) && h.TryGetProperty("booleanValue", out var b) && b.GetBoolean())
                       .Select(d => d.Id).ToHashSet(StringComparer.Ordinal);

    private static IEnumerable<(string Id, JsonElement Fields)> Documents(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("documents", out var docs) || docs.ValueKind != JsonValueKind.Array) yield break;
        foreach (var d in docs.EnumerateArray())
        {
            if (!d.TryGetProperty("name", out var n) || !d.TryGetProperty("fields", out var f)) continue;
            var name = n.GetString() ?? "";
            yield return (name[(name.LastIndexOf('/') + 1)..], f.Clone());
        }
    }

    private static string? Str(JsonElement f, string key) =>
        f.TryGetProperty(key, out var v) && v.TryGetProperty("stringValue", out var s) ? s.GetString() : null;

    private static long Int(JsonElement f, string key) =>
        f.TryGetProperty(key, out var v) && v.TryGetProperty("integerValue", out var s) && long.TryParse(s.GetString(), out var x) ? x : 0;
}

/// <summary>
/// The admin's hidden list as the app last saw it (hidden.json in the app's data folder), so hidden buddies stay hidden
/// when the app starts offline and in the screensaver, which never goes online.
/// </summary>
public static class HiddenList
{
    public const string FileName = "hidden.json";

    public static IReadOnlySet<string> Load(string dataRoot)
    {
        try
        {
            var ids = JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(dataRoot, FileName))) ?? [];
            return ids.Where(i => !string.IsNullOrEmpty(i)).ToHashSet(StringComparer.Ordinal);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            return new HashSet<string>(StringComparer.Ordinal);
        }
    }

    public static void Save(string dataRoot, IEnumerable<string> ids)
    {
        try
        {
            Directory.CreateDirectory(dataRoot);
            var path = Path.Combine(dataRoot, FileName);
            File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(ids.OrderBy(i => i, StringComparer.Ordinal).ToArray()));
            File.Move(path + ".tmp", path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
