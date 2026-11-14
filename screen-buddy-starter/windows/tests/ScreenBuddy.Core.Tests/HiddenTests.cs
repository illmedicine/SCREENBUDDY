using ScreenBuddy.Core;
using Xunit;

namespace ScreenBuddy.Core.Tests;

public class HiddenTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("sb-hidden").FullName;

    private BuddyLibrary Lib() => new(Data.BuddiesDir, Path.Combine(_dir, "user"));

    [Fact]
    public void HiddenBuiltInBuddiesAreLeftOut()
    {
        var all = Lib().List().Select(b => b.Id).ToList();
        Assert.Contains("claw", all);
        Assert.Contains("body", all);

        var lib = Lib();
        lib.Hidden = new HashSet<string> { "claw", "body" };
        var shown = lib.List().Select(b => b.Id).ToList();
        Assert.DoesNotContain("claw", shown);
        Assert.DoesNotContain("body", shown);
        Assert.Equal(all.Count - 2, shown.Count);
    }

    [Fact]
    public void FindFallsBackToAVisibleBuddy()
    {
        var lib = Lib();
        lib.Hidden = new HashSet<string> { "claw" };
        var b = lib.Find("claw");
        Assert.NotNull(b);
        Assert.NotEqual("claw", b!.Id);
        Assert.False(lib.Hidden.Contains(b.Id));
    }

    [Fact]
    public void HidingEverythingLeavesNothing()
    {
        var lib = Lib();
        lib.Hidden = Lib().List().Select(b => b.Id).ToHashSet();
        Assert.Empty(lib.List());
        Assert.Null(lib.Find(null));
    }

    [Fact]
    public void UnhidingBringsThemBack()
    {
        var lib = Lib();
        lib.Hidden = new HashSet<string> { "claw" };
        lib.Hidden = new HashSet<string>();
        Assert.Contains(lib.List(), b => b.Id == "claw");
    }

    [Fact]
    public void ParsesTheAdminsHiddenFlags()
    {
        const string json = """
        {"documents": [
          {"name": "projects/p/databases/(default)/documents/buddies/body", "fields": {"hidden": {"booleanValue": true}, "name": {"stringValue": "Body"}}},
          {"name": "projects/p/databases/(default)/documents/buddies/claw", "fields": {"hidden": {"booleanValue": true}}},
          {"name": "projects/p/databases/(default)/documents/buddies/kiah", "fields": {"hidden": {"booleanValue": false}}},
          {"name": "projects/p/databases/(default)/documents/buddies/nadi", "fields": {"name": {"stringValue": "Polka Dot"}}}
        ]}
        """;
        Assert.Equal(new[] { "body", "claw" }, CloudCatalog.ParseHidden(json).OrderBy(x => x));
    }

    [Fact]
    public void SavedListRoundTripsAndSurvivesDamage()
    {
        Assert.Empty(HiddenList.Load(_dir));                                   // nothing saved yet
        HiddenList.Save(_dir, new[] { "claw", "body" });
        Assert.Equal(new[] { "body", "claw" }, HiddenList.Load(_dir).OrderBy(x => x));
        File.WriteAllText(Path.Combine(_dir, HiddenList.FileName), "{broken");
        Assert.Empty(HiddenList.Load(_dir));
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }
}
