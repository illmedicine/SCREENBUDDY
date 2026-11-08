using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using ScreenBuddy.Core;
using Xunit;

namespace ScreenBuddy.Core.Tests;

internal static class Data
{
    public static string BuddiesDir => Path.Combine(AppContext.BaseDirectory, "buddies");
    public static string ClawJson => File.ReadAllText(Path.Combine(BuddiesDir, "claw", "manifest.json"));
    public static BuddyManifest Claw => BuddyManifest.Parse(ClawJson);

    /// <summary>The shipped manifest with one edit applied.</summary>
    public static string Edit(Action<JsonObject> change)
    {
        var o = JsonNode.Parse(ClawJson)!.AsObject();
        change(o);
        return o.ToJsonString();
    }

    public static byte[] Webp() => Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPVP8 ........");

    public static MemoryStream Zip(IEnumerable<(string Name, byte[] Bytes)> entries)
    {
        var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, bytes) in entries)
            {
                using var s = z.CreateEntry(name).Open();
                s.Write(bytes);
            }
        ms.Position = 0;
        return ms;
    }

    /// <summary>A small valid package with the given id, using the shipped claw layout.</summary>
    public static IEnumerable<(string, byte[])> Package(string id)
    {
        var m = JsonNode.Parse(ClawJson)!.AsObject();
        m["id"] = id;
        yield return ("manifest.json", Encoding.UTF8.GetBytes(m.ToJsonString()));
        yield return ("face.webp", Webp());
        foreach (var clip in m["clips"]!.AsObject()) yield return (clip.Value!["src"]!.GetValue<string>(), Webp());
    }
}

public class AnimatorTests
{
    private static BuddyAnimator Make(Func<string, bool>? ready = null, int seed = 1)
    {
        var rng = new Random(seed);
        return new BuddyAnimator(Data.Claw, rng.NextDouble, ready);
    }

    [Fact]
    public void StartsOnTheStandingFrame()
    {
        var a = Make();
        Assert.Equal(new FramePick("hips", 0), a.Frame);
        Assert.False(a.Animating);
    }

    [Fact]
    public void ScrollingStepsThroughTheWalkOneFramePerStep()
    {
        var a = Make();
        a.Scrub(28, 0);
        Assert.Equal(new FramePick("strut", 1), a.Frame);
        a.Scrub(28 * 8, 10);
        Assert.Equal(new FramePick("strut", 9), a.Frame);
    }

    [Fact]
    public void TheWalkPlaysBackwardsAtTheEndInsteadOfSnapping()
    {
        var a = Make();
        a.Scrub(28 * 10, 0);
        Assert.Equal(new FramePick("strut", 8), a.Frame);
        a.Scrub(28 * 8, 10);
        Assert.Equal(new FramePick("strut", 0), a.Frame);
    }

    [Fact]
    public void LeanFollowsMovementAndIsClampedToFiveDegrees()
    {
        var a = Make();
        a.Scrub(16, 0);
        Assert.Equal(2f, a.Lean);
        a.Scrub(-500, 1);
        Assert.Equal(-5f, a.Lean);
    }

    [Fact]
    public void GoesBackToStandingAfterMovementStops()
    {
        var a = Make();
        a.Scrub(60, 1000);
        a.Update(1449);
        Assert.True(a.Animating);
        a.Update(1450);
        Assert.False(a.Animating);
        Assert.Equal(new FramePick("hips", 0), a.Frame);
        Assert.Equal(0f, a.Lean);
    }

    [Fact]
    public void ATapStartsAPoseAndNeverRepeatsTheLastOne()
    {
        var a = Make();
        var last = "";
        long t = 0;
        for (var i = 0; i < 40; i++)
        {
            Assert.True(a.Tap(t));
            var move = a.Frame.Move;
            Assert.Contains(move, Data.Claw.Poses);
            Assert.NotEqual(last, move);
            last = move;
            t += 10_000;
            a.Update(t);
            Assert.False(a.Posing);
        }
    }

    [Fact]
    public void ASecondTapDuringAPoseIsIgnored()
    {
        var a = Make();
        Assert.True(a.Tap(0));
        Assert.False(a.Tap(100));
    }

    [Fact]
    public void ShortPosesPlayForwardsThenBackwards()
    {
        var a = Make();
        Assert.True(a.Play("hips", 0));        // 17 frames: 33 steps there and back
        a.Update(0);    Assert.Equal(new FramePick("hips", 0), a.Frame);
        a.Update(1600); Assert.Equal(new FramePick("hips", 16), a.Frame);
        a.Update(1700); Assert.Equal(new FramePick("hips", 15), a.Frame);
        a.Update(3200); Assert.Equal(new FramePick("hips", 0), a.Frame);
        Assert.True(a.Posing);
        a.Update(3300);
        Assert.False(a.Posing);
    }

    [Fact]
    public void LongPosesPlayOnce()
    {
        var a = Make();
        Assert.True(a.Play("wave", 0));        // 40 frames at 10 fps = 4 s
        a.Update(3900); Assert.Equal(new FramePick("wave", 39), a.Frame);
        Assert.True(a.Posing);
        a.Update(4000);
        Assert.False(a.Posing);
    }

    [Fact]
    public void MovementDuringAPoseDoesNotInterruptIt()
    {
        var a = Make();
        a.Play("wave", 0);
        a.Update(500);
        var before = a.Frame;
        a.Scrub(200, 600);
        Assert.Equal(before, a.Frame);
        Assert.True(a.Posing);
    }

    [Fact]
    public void NeverChoosesAMoveThatHasNotLoaded()
    {
        var a = Make(m => m == "arms");
        for (var i = 0; i < 10; i++)
        {
            Assert.True(a.Tap(i * 10_000L));
            Assert.Equal("arms", a.Frame.Move);
            a.Update(i * 10_000L + 9_999);
        }
    }

    [Fact]
    public void TapDoesNothingWhenNothingHasLoaded()
    {
        var a = Make(_ => false);
        Assert.False(a.Tap(0));
        a.Scrub(100, 0);
        Assert.Equal(new FramePick("hips", 0), a.Frame);
    }

    [Fact]
    public void StopDropsAPoseAndReturnsToStanding()
    {
        var a = Make();
        a.Play("wave", 0);
        a.Update(500);
        a.Stop();
        Assert.False(a.Posing);
        Assert.False(a.Animating);
        Assert.Equal(new FramePick("hips", 0), a.Frame);
    }

    [Fact]
    public void LayoutLeavesRoomForTheLeanAndStandsOnTheBottomEdge()
    {
        var m = Data.Claw;
        var w = BuddyLayout.WindowWidth(376, m);
        Assert.True(w > m.Cw, "the window is wider than the buddy");
        var (x, y, dw, dh) = BuddyLayout.Fit(w, 376, m);
        Assert.Equal(376, y + dh, 3);                    // feet on the bottom edge
        Assert.Equal(x, w - (x + dw), 3);                // centred
        Assert.True(x > 0);
    }
}

public class ManifestTests
{
    [Fact]
    public void EveryShippedBuddyParsesAndItsFilesExist()
    {
        var dirs = Directory.GetDirectories(Data.BuddiesDir);
        Assert.Equal(12, dirs.Length);
        foreach (var dir in dirs)
        {
            var m = BuddyManifest.Parse(File.ReadAllText(Path.Combine(dir, "manifest.json")));
            Assert.Equal(Path.GetFileName(dir), m.Id);
            foreach (var file in m.Clips.Values.Select(c => c.Src).Append(m.Face))
            {
                var path = Path.Combine(dir, file);
                Assert.True(File.Exists(path), path);
                var head = File.ReadAllBytes(path).Take(12).ToArray();
                Assert.Equal("RIFF", Encoding.ASCII.GetString(head, 0, 4));
                Assert.Equal("WEBP", Encoding.ASCII.GetString(head, 8, 4));
            }
        }
    }

    [Theory]
    [InlineData("../strut.webp")]
    [InlineData("/etc/passwd")]
    [InlineData("a/b.webp")]
    [InlineData("strut.png")]
    public void RejectsClipFilesThatEscapeThePackage(string src) =>
        Assert.Throws<InvalidBuddyException>(() => BuddyManifest.Parse(Data.Edit(o => o["clips"]!["strut"]!["src"] = src)));

    [Fact]
    public void RejectsUnknownMovesAndOutOfRangeStandFrames()
    {
        Assert.Throws<InvalidBuddyException>(() => BuddyManifest.Parse(Data.Edit(o => o["poses"] = new JsonArray("moonwalk"))));
        Assert.Throws<InvalidBuddyException>(() => BuddyManifest.Parse(Data.Edit(o => o["stand"] = new JsonArray("moonwalk", 0))));
        Assert.Throws<InvalidBuddyException>(() => BuddyManifest.Parse(Data.Edit(o => o["stand"] = new JsonArray("hips", 17))));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("null")]
    public void RejectsGarbage(string json) => Assert.Throws<InvalidBuddyException>(() => BuddyManifest.Parse(json));
}

public class LibraryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "sb-test-" + Guid.NewGuid().ToString("N"));
    private BuddyLibrary Lib() => new(Data.BuddiesDir, Path.Combine(_root, "user"));
    public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true); }

    [Fact]
    public void ListsTheBundledBuddies()
    {
        var all = Lib().List();
        Assert.Equal(["ansell", "body", "claw", "jessie-jessica", "kaylab", "kenna", "kiah", "nadi", "nadi-wiggles", "pariya", "queen-aono", "roseylucci"], all.Select(b => b.Id).OrderBy(x => x).ToArray());
        Assert.All(all, b => Assert.True(b.Bundled));
    }

    [Fact]
    public void FindFallsBackToTheFirstBuddy()
    {
        Assert.Equal("claw", Lib().Find("claw")!.Id);
        Assert.NotNull(Lib().Find("gone"));
        Assert.NotNull(Lib().Find(null));
    }

    [Fact]
    public void ImportsAValidPackageAndListsIt()
    {
        var lib = Lib();
        var b = lib.ImportZip(Data.Zip(Data.Package("my-buddy")));
        Assert.False(b.Bundled);
        Assert.Contains(lib.List(), x => x.Id == "my-buddy" && !x.Bundled);
        lib.Delete(b);
        Assert.DoesNotContain(lib.List(), x => x.Id == "my-buddy");
    }

    [Fact]
    public void RejectsAnIdThatClashesWithABuiltInBuddy() =>
        Assert.Throws<InvalidBuddyException>(() => Lib().ImportZip(Data.Zip(Data.Package("claw"))));

    [Theory]
    [InlineData("../evil.webp")]
    [InlineData("dir/x.webp")]
    [InlineData(".hidden")]
    [InlineData("a\\b.webp")]
    public void RejectsPathsThatLeaveThePackage(string name)
    {
        var entries = Data.Package("evil").Append((name, Data.Webp()));
        Assert.Throws<InvalidBuddyException>(() => Lib().ImportZip(Data.Zip(entries)));
    }

    [Fact]
    public void RejectsAMissingOrNonWebpFileAndKeepsNothing()
    {
        var lib = Lib();
        var missing = Data.Package("half").Where(e => e.Item1 != "wave.webp");
        Assert.Throws<InvalidBuddyException>(() => lib.ImportZip(Data.Zip(missing)));
        var notWebp = Data.Package("fake").Select(e => e.Item1 == "hips.webp" ? (e.Item1, Encoding.ASCII.GetBytes("not an image at all")) : e);
        Assert.Throws<InvalidBuddyException>(() => lib.ImportZip(Data.Zip(notWebp)));
        Assert.DoesNotContain(lib.List(), b => b.Id is "half" or "fake");
    }

    [Fact]
    public void RejectsNonZipsAndZipsWithoutAManifest()
    {
        Assert.Throws<InvalidBuddyException>(() => Lib().ImportZip(new MemoryStream([1, 2, 3, 4, 5, 6, 7, 8])));
        Assert.Throws<InvalidBuddyException>(() => Lib().ImportZip(Data.Zip([("face.webp", Data.Webp())])));
    }

    [Fact]
    public void RejectsAZipWithAnOversizedFile()
    {
        var big = new byte[BuddyLibrary.MaxFileBytes + 1];
        var entries = Data.Package("big").Select(e => e.Item1 == "wave.webp" ? (e.Item1, big) : e);
        Assert.Throws<InvalidBuddyException>(() => Lib().ImportZip(Data.Zip(entries)));
    }
}

public class SettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "sb-settings-" + Guid.NewGuid().ToString("N"));
    private string PathFor(string name) => Path.Combine(_dir, name);
    public void Dispose() { if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true); }

    [Fact]
    public void RoundTrips()
    {
        var store = new SettingsStore(PathFor("s.json"));
        store.Save(new AppSettings { BuddyId = "body", Height = 300, Opacity = 60, StayOnBottom = true, X = 10.5, Y = 20 });
        var s = store.Load();
        Assert.Equal("body", s.BuddyId);
        Assert.Equal(300, s.Height);
        Assert.Equal(60, s.Opacity);
        Assert.True(s.StayOnBottom);
        Assert.Equal(10.5, s.X);
    }

    [Fact]
    public void MissingOrDamagedFilesGiveDefaults()
    {
        Assert.Equal(new AppSettings(), new SettingsStore(PathFor("nope.json")).Load());
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathFor("bad.json"), "{ this is not json");
        Assert.Equal(new AppSettings(), new SettingsStore(PathFor("bad.json")).Load());
    }

    [Fact]
    public void OutOfRangeValuesAreClamped()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(PathFor("wild.json"), """{"Height": 99999, "Opacity": 0}""");
        var s = new SettingsStore(PathFor("wild.json")).Load();
        Assert.Equal(AppSettings.MaxHeight, s.Height);
        Assert.Equal(AppSettings.MinOpacity, s.Opacity);
    }
}
