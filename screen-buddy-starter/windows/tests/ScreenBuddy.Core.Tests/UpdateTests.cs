using System.Text;
using System.Text.Json.Nodes;
using ScreenBuddy.Core;
using Xunit;

namespace ScreenBuddy.Core.Tests;

public class AppVersionTests
{
    [Theory]
    [InlineData("1.2.3", 1, 2, 3, 0, null)]
    [InlineData("v1.2.3", 1, 2, 3, 0, null)]
    [InlineData("1.2", 1, 2, 0, 0, null)]
    [InlineData("7", 7, 0, 0, 0, null)]
    [InlineData("1.2.3.4", 1, 2, 3, 4, null)]
    [InlineData("1.3.0-beta.2", 1, 3, 0, 0, "beta.2")]
    [InlineData("0.4.0+abc123def", 0, 4, 0, 0, null)]                    // .NET adds the commit to InformationalVersion
    [InlineData(" 2.0.0-rc.1+build.5 ", 2, 0, 0, 0, "rc.1")]
    public void Parses(string text, int major, int minor, int patch, int rev, string? pre)
    {
        var v = AppVersion.Parse(text);
        Assert.Equal((major, minor, patch, rev, pre), (v.Major, v.Minor, v.Patch, v.Revision, v.Prerelease));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("v")]
    [InlineData("1..2")]
    [InlineData("1.2.3.4.5")]
    [InlineData("1.-2")]
    [InlineData("1.2.x")]
    [InlineData("1.2.3-")]
    [InlineData("1.2.3-beta..1")]
    [InlineData("99999999999.0")]
    [InlineData("windows-v1.2.3")]
    public void RejectsJunk(string? text)
    {
        Assert.False(AppVersion.TryParse(text, out _));
        Assert.Throws<InvalidUpdateException>(() => AppVersion.Parse(text));
    }

    [Theory]
    [InlineData("1.0.0", "1.0.1")]
    [InlineData("1.0.9", "1.1.0")]
    [InlineData("1.9.0", "1.10.0")]                // numbers, not strings
    [InlineData("1.99.99", "2.0.0")]
    [InlineData("1.2.3", "1.2.3.1")]
    [InlineData("1.0.0-beta", "1.0.0")]            // a pre-release comes before its release
    [InlineData("1.0.0-alpha", "1.0.0-alpha.1")]
    [InlineData("1.0.0-alpha.1", "1.0.0-alpha.beta")]
    [InlineData("1.0.0-beta.2", "1.0.0-beta.11")]
    [InlineData("1.0.0-rc.1", "1.0.0")]
    [InlineData("0.1.0", "0.2.0-beta")]
    public void Orders(string lower, string higher)
    {
        var a = AppVersion.Parse(lower);
        var b = AppVersion.Parse(higher);
        Assert.True(a < b);
        Assert.True(b > a);
        Assert.True(a.CompareTo(b) < 0 && b.CompareTo(a) > 0);
        Assert.False(a.Equals(b));
    }

    [Theory]
    [InlineData("1.2", "1.2.0")]
    [InlineData("v1.2.0", "1.2.0.0")]
    [InlineData("1.2.0+abc", "1.2.0")]
    public void TreatsSpellingsAsEqual(string a, string b)
    {
        Assert.Equal(AppVersion.Parse(a), AppVersion.Parse(b));
        Assert.Equal(AppVersion.Parse(a).GetHashCode(), AppVersion.Parse(b).GetHashCode());
        Assert.True(AppVersion.Parse(a) >= AppVersion.Parse(b) && AppVersion.Parse(a) <= AppVersion.Parse(b));
    }

    [Fact]
    public void PrintsBack()
    {
        Assert.Equal("1.2.0", AppVersion.Parse("v1.2").ToString());
        Assert.Equal("1.2.3.4-rc.1", AppVersion.Parse("1.2.3.4-rc.1+x").ToString());
    }
}

public class UpdateManifestTests
{
    private const string Sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    private static string Json(Action<JsonObject>? change = null)
    {
        var o = new JsonObject
        {
            ["version"] = "1.4.0",
            ["url"] = "https://github.com/illmedicine/SCREENBUDDY/releases/download/windows-v1.4.0/ScreenBuddy-win-x64-1.4.0.zip",
            ["sha256"] = Sha,
            ["size"] = 123456,
            ["notes"] = "Three new buddies",
        };
        change?.Invoke(o);
        return o.ToJsonString();
    }

    [Fact]
    public void ParsesAGoodManifest()
    {
        var m = UpdateManifest.Parse(Json());
        Assert.Equal(AppVersion.Parse("1.4.0"), m.Version);
        Assert.Equal("github.com", m.Url.Host);
        Assert.Equal(Sha, m.Sha256);
        Assert.Equal(123456, m.Size);
        Assert.Equal("Three new buddies", m.Notes);
    }

    [Fact]
    public void AcceptsUpperCaseHashAndNoNotes()
    {
        var m = UpdateManifest.Parse(Json(o => { o["sha256"] = Sha.ToUpperInvariant(); o.Remove("notes"); }));
        Assert.Equal(Sha, m.Sha256);
        Assert.Null(m.Notes);
    }

    public static TheoryData<string> BadManifests => new()
    {
        "",
        "not json",
        "[]",
        Json(o => o.Remove("version")),
        Json(o => o["version"] = "latest"),
        Json(o => o["version"] = 140),
        Json(o => o.Remove("url")),
        Json(o => o["url"] = "http://github.com/a/b/c.zip"),                     // not https
        Json(o => o["url"] = "https://evil.example.com/ScreenBuddy.zip"),        // not github
        Json(o => o["url"] = "https://github.com.evil.example/x.zip"),
        Json(o => o["url"] = "https://user@github.com/x.zip"),
        Json(o => o["url"] = "https://github.com:8443/x.zip"),
        Json(o => o["url"] = "/releases/x.zip"),
        Json(o => o.Remove("sha256")),
        Json(o => o["sha256"] = "abc"),
        Json(o => o["sha256"] = new string('g', 64)),
        Json(o => o.Remove("size")),
        Json(o => o["size"] = 0),
        Json(o => o["size"] = -5),
        Json(o => o["size"] = "123"),
        Json(o => o["size"] = UpdateManifest.MaxSize + 1),
    };

    [Theory]
    [MemberData(nameof(BadManifests))]
    public void RejectsBadManifests(string json) =>
        Assert.Throws<InvalidUpdateException>(() => UpdateManifest.Parse(json));

    [Fact]
    public void HashesLikeSha256Sum() =>
        Assert.Equal(Sha, UpdateManifest.Sha256Hex(new MemoryStream(Encoding.ASCII.GetBytes("test"))));
}

public class ReleaseChannelTests
{
    [Fact]
    public void ParsesChannel()
    {
        var c = ReleaseChannel.Parse("""{"repo":"illmedicine/SCREENBUDDY","tagPrefix":"windows-v"}""");
        Assert.Equal("illmedicine/SCREENBUDDY", c.Repo);
        Assert.Equal("windows-v", c.TagPrefix);
        Assert.Equal("https://api.github.com/repos/illmedicine/SCREENBUDDY/releases?per_page=30", c.ReleasesApi.ToString());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"repo":"no-slash"}""")]
    [InlineData("""{"repo":"a/b/c"}""")]
    [InlineData("""{"repo":"a/b?x=1"}""")]
    [InlineData("""{"repo":"a/b","tagPrefix":"../"}""")]
    [InlineData("nope")]
    public void RejectsBadChannel(string json) =>
        Assert.Throws<InvalidUpdateException>(() => ReleaseChannel.Parse(json));

    [Fact]
    public void MissingFileMeansNoUpdates()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        try
        {
            Assert.Null(ReleaseChannel.Load(dir));
            File.WriteAllText(Path.Combine(dir, ReleaseChannel.FileName), "{broken");
            Assert.Null(ReleaseChannel.Load(dir));
            File.WriteAllText(Path.Combine(dir, ReleaseChannel.FileName), """{"repo":"a/b","tagPrefix":"windows-v"}""");
            Assert.Equal(new ReleaseChannel("a/b", "windows-v"), ReleaseChannel.Load(dir));
        }
        finally { Directory.Delete(dir, true); }
    }
}

public class GitHubReleasesTests
{
    private static readonly ReleaseChannel Channel = new("illmedicine/SCREENBUDDY", "windows-v");

    private static JsonObject Release(string tag, bool draft = false, bool pre = false, bool manifest = true)
    {
        var assets = new JsonArray
        {
            new JsonObject { ["name"] = $"ScreenBuddy-win-x64.zip", ["browser_download_url"] = $"https://github.com/illmedicine/SCREENBUDDY/releases/download/{tag}/ScreenBuddy-win-x64.zip" },
        };
        if (manifest)
            assets.Add(new JsonObject { ["name"] = "update.json", ["browser_download_url"] = $"https://github.com/illmedicine/SCREENBUDDY/releases/download/{tag}/update.json" });
        return new JsonObject { ["tag_name"] = tag, ["draft"] = draft, ["prerelease"] = pre, ["assets"] = assets };
    }

    private static string List(params JsonObject[] releases) => new JsonArray(releases).ToJsonString();

    [Fact]
    public void PicksTheHighestDesktopRelease()
    {
        var json = List(
            Release("windows-v1.2.0"),
            Release("android-v9.0.0"),                         // another platform's release
            Release("windows-v1.10.0"),
            Release("windows-v1.3.0"),
            Release("v5.0.0"));
        var best = GitHubReleases.FindLatest(json, Channel);
        Assert.NotNull(best);
        Assert.Equal("windows-v1.10.0", best!.Tag);
        Assert.Equal(AppVersion.Parse("1.10.0"), best.Version);
        Assert.EndsWith("/windows-v1.10.0/update.json", best.ManifestUrl.ToString());
    }

    [Fact]
    public void SkipsDraftsPrereleasesAndReleasesWithoutManifest()
    {
        var json = List(
            Release("windows-v1.0.0"),
            Release("windows-v2.0.0", draft: true),
            Release("windows-v3.0.0", pre: true),
            Release("windows-v4.0.0-beta.1"),
            Release("windows-v5.0.0", manifest: false),
            Release("windows-vnext"));
        Assert.Equal("windows-v1.0.0", GitHubReleases.FindLatest(json, Channel)!.Tag);
    }

    [Fact]
    public void IgnoresManifestsHostedElsewhere()
    {
        var bad = Release("windows-v2.0.0");
        bad["assets"]![1]!["browser_download_url"] = "https://evil.example.com/update.json";
        Assert.Equal("windows-v1.0.0", GitHubReleases.FindLatest(List(Release("windows-v1.0.0"), bad), Channel)!.Tag);
    }

    [Fact]
    public void NothingToOffer()
    {
        Assert.Null(GitHubReleases.FindLatest("[]", Channel));
        Assert.Null(GitHubReleases.FindLatest(List(Release("android-v1.0.0")), Channel));
    }

    [Theory]
    [InlineData("{\"message\":\"API rate limit exceeded\"}")]
    [InlineData("<html>")]
    public void RejectsNonList(string json) =>
        Assert.Throws<InvalidUpdateException>(() => GitHubReleases.FindLatest(json, Channel));
}

public class UpdatePreferencesTests
{
    [Fact]
    public void DefaultsToAutoUpdateAndRoundTrips()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        try
        {
            var store = new UpdatePreferencesStore(Path.Combine(dir, "sub", "updates.json"));
            Assert.True(store.Load().AutoUpdate);
            Assert.False(store.Load().ShortcutsCreated);
            store.Save(new UpdatePreferences { AutoUpdate = false, ShortcutsCreated = true });
            Assert.False(store.Load().AutoUpdate);
            Assert.True(store.Load().ShortcutsCreated);
            File.WriteAllText(Path.Combine(dir, "sub", "updates.json"), "garbage");
            Assert.True(store.Load().AutoUpdate);
        }
        finally { Directory.Delete(dir, true); }
    }
}

public class InstallSwapperTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("sb-swap").FullName;
    private string Old => Path.Combine(_root, "app");
    private string New => Path.Combine(_root, "staged");

    public InstallSwapperTests()
    {
        Write(Old, "ScreenBuddy.exe", "old exe");
        Write(Old, "ScreenBuddy.dll", "old dll");
        Write(Old, "ScreenBuddy.scr", "old exe");
        Write(Old, "Retired.dll", "gone in the new version");
        Write(Old, "buddies/claw/manifest.json", "old claw");
        Write(Old, "buddies/retired/manifest.json", "removed buddy");

        Write(New, "ScreenBuddy.exe", "new exe");
        Write(New, "ScreenBuddy.dll", "new dll");
        Write(New, "release.json", "{}");
        Write(New, "buddies/claw/manifest.json", "new claw");
        Write(New, "buddies/nadi/manifest.json", "new buddy");
    }

    private static void Write(string dir, string rel, string text)
    {
        var path = Path.Combine(dir, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    private string Read(string rel) => File.ReadAllText(Path.Combine(Old, rel));
    private bool Has(string rel) => File.Exists(Path.Combine(Old, rel)) || Directory.Exists(Path.Combine(Old, rel));

    [Fact]
    public void ReplacesTheInstallWithTheNewVersion()
    {
        InstallSwapper.Apply(New, Old);

        Assert.Equal("new exe", Read("ScreenBuddy.exe"));
        Assert.Equal("new dll", Read("ScreenBuddy.dll"));
        Assert.Equal("new claw", Read("buddies/claw/manifest.json"));
        Assert.Equal("new buddy", Read("buddies/nadi/manifest.json"));
        Assert.Equal("{}", Read("release.json"));
        Assert.False(Has("Retired.dll"));
        Assert.False(Has("buddies/retired"));                          // removed built-ins go, folder and all
        Assert.Equal("new exe", Read("ScreenBuddy.scr"));              // screensaver copy kept and refreshed
        Assert.Empty(Directory.GetDirectories(Old, InstallSwapper.BackupPrefix + "*"));
        Assert.Equal("new exe", File.ReadAllText(Path.Combine(New, "ScreenBuddy.exe")));   // source untouched
    }

    [Fact]
    public void RollsBackWhenACopyFails()
    {
        var before = Snapshot(Old);
        Assert.Throws<IOException>(() => InstallSwapper.Apply(New, Old, rel =>
        {
            if (rel.Contains("nadi")) throw new IOException("disk full");
        }));
        Assert.Equal(before, Snapshot(Old));
        Assert.Empty(Directory.GetDirectories(Old, InstallSwapper.BackupPrefix + "*"));
    }

    [Fact]
    public void RefusesFoldersThatAreNotAnInstall()
    {
        var empty = Path.Combine(_root, "empty");
        Directory.CreateDirectory(empty);
        Assert.Throws<InvalidUpdateException>(() => InstallSwapper.Apply(empty, Old));
        Assert.Throws<InvalidUpdateException>(() => InstallSwapper.Apply(New, empty));
        Assert.Throws<InvalidUpdateException>(() => InstallSwapper.Apply(Old, Old));

        var nested = Path.Combine(Old, "updates", "staged");
        Write(nested, "ScreenBuddy.exe", "x");
        Assert.Throws<InvalidUpdateException>(() => InstallSwapper.Apply(nested, Old));
        Assert.Throws<InvalidUpdateException>(() => InstallSwapper.Apply(Old, nested));
    }

    [Fact]
    public void CleanUpRemovesLeftoverBackups()
    {
        Write(Old, InstallSwapper.BackupPrefix + "-20260101/ScreenBuddy.dll", "stale");
        InstallSwapper.CleanUp(Old);
        Assert.Empty(Directory.GetDirectories(Old, InstallSwapper.BackupPrefix + "*"));
        Assert.True(Has("ScreenBuddy.exe"));
    }

    private static Dictionary<string, string> Snapshot(string dir) =>
        Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .ToDictionary(f => Path.GetRelativePath(dir, f).Replace('\\', '/'), File.ReadAllText);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }
}
