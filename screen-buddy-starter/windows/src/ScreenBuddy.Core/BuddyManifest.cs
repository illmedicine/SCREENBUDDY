using System.Text.Json;
using System.Text.RegularExpressions;

namespace ScreenBuddy.Core;

/// <summary>One move: <see cref="N"/> frames laid out side by side in the strip file <see cref="Src"/>.</summary>
public sealed record Clip(int N, string Src);

public sealed class InvalidBuddyException(string message) : Exception(message);

/// <summary>
/// Describes a buddy package. The same rules as the Android app and the web player, so one package works
/// everywhere. Packages can come from anyone, so nothing in a manifest may name a file outside the package.
/// </summary>
public sealed record BuddyManifest(
    string Id,
    string Name,
    string Author,
    int Version,
    string From,
    int Cw,
    int Ch,
    int Fps,
    string StandClip,
    int StandFrame,
    string Scroll,
    IReadOnlyList<string> Poses,
    string Face,
    IReadOnlyDictionary<string, Clip> Clips)
{
    public const string FileName = "manifest.json";

    private static readonly Regex IdPattern = new("^[a-z0-9][a-z0-9_-]{0,63}$", RegexOptions.Compiled);
    private static readonly Regex MovePattern = new("^[A-Za-z0-9_-]{1,32}$", RegexOptions.Compiled);
    private static readonly Regex FilePattern = new("^[A-Za-z0-9_-]{1,64}\\.webp$", RegexOptions.Compiled);

    public static BuddyManifest Parse(string json)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(json); }
        catch (JsonException) { throw new InvalidBuddyException("Not a valid buddy manifest"); }
        using (doc)
        {
            var o = doc.RootElement;
            if (o.ValueKind != JsonValueKind.Object) throw new InvalidBuddyException("Not a valid buddy manifest");

            var id = Text(o, "id");
            if (!IdPattern.IsMatch(id)) throw new InvalidBuddyException($"Bad id '{id}'");

            if (!o.TryGetProperty("clips", out var clipsJson) || clipsJson.ValueKind != JsonValueKind.Object)
                throw new InvalidBuddyException("Missing clips");
            var clips = new Dictionary<string, Clip>(StringComparer.Ordinal);
            foreach (var p in clipsJson.EnumerateObject())
            {
                if (!MovePattern.IsMatch(p.Name)) throw new InvalidBuddyException($"Bad move name '{p.Name}'");
                if (p.Value.ValueKind != JsonValueKind.Object) throw new InvalidBuddyException($"Bad clip '{p.Name}'");
                var src = Text(p.Value, "src");
                if (!FilePattern.IsMatch(src)) throw new InvalidBuddyException($"Bad clip file '{src}'");
                clips[p.Name] = new Clip(Int(p.Value, "n", 1, 400, $"frame count of '{p.Name}'"), src);
            }

            string Known(string? name) =>
                name is not null && clips.ContainsKey(name) ? name : throw new InvalidBuddyException($"Unknown move '{name}'");

            if (!o.TryGetProperty("stand", out var stand) || stand.ValueKind != JsonValueKind.Array || stand.GetArrayLength() != 2)
                throw new InvalidBuddyException("Bad stand");
            var standClip = Known(stand[0].ValueKind == JsonValueKind.String ? stand[0].GetString() : null);
            if (stand[1].ValueKind != JsonValueKind.Number || !stand[1].TryGetInt32(out var standFrame) ||
                standFrame < 0 || standFrame >= clips[standClip].N)
                throw new InvalidBuddyException($"Stand frame is outside '{standClip}'");

            var scroll = Known(o.TryGetProperty("scroll", out var sc) && sc.ValueKind == JsonValueKind.String ? sc.GetString() : null);
            if (!o.TryGetProperty("poses", out var posesJson) || posesJson.ValueKind != JsonValueKind.Array)
                throw new InvalidBuddyException("Bad poses");
            var poses = posesJson.EnumerateArray()
                .Select(e => Known(e.ValueKind == JsonValueKind.String ? e.GetString() : null)).ToList();

            var face = Text(o, "face");
            if (!FilePattern.IsMatch(face)) throw new InvalidBuddyException($"Bad face file '{face}'");

            return new BuddyManifest(
                id, Text(o, "name"),
                o.TryGetProperty("author", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString()! : "",
                o.TryGetProperty("version", out var v) && v.TryGetInt32(out var ver) ? ver : 1,
                o.TryGetProperty("from", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString()! : "",
                Int(o, "cw", 16, 2048, "cell width"), Int(o, "ch", 16, 2048, "cell height"),
                o.TryGetProperty("fps", out _) ? Int(o, "fps", 1, 60, "fps") : 10,
                standClip, standFrame, scroll, poses, face, clips);
        }
    }

    private static string Text(JsonElement o, string key) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())
            ? v.GetString()!
            : throw new InvalidBuddyException($"Missing {key}");

    private static int Int(JsonElement o, string key, int lo, int hi, string what) =>
        o.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) && n >= lo && n <= hi
            ? n
            : throw new InvalidBuddyException($"Bad {what}");
}
