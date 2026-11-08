using System.Text.Json.Nodes;
using ScreenBuddy.Core.Billing;
using Xunit;

namespace ScreenBuddy.Core.Tests;

/// <summary>Replays billing/scenarios.json, the same vectors the web and Android tests use.</summary>
public class BillingTests
{
    private static JsonObject Shared(string name) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "billing", name)))!.AsObject();

    private static long T(string iso) => DateTimeOffset.Parse(iso).ToUnixTimeMilliseconds();
    private static string Iso(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ");

    [Fact]
    public void CatalogIsTheSharedOne()
    {
        var j = Shared("catalog.json");
        var c = Catalog.Default;
        Assert.Equal((int)j["version"]!, c.Version);
        Assert.Equal((string)j["currency"]!, c.Currency);
        Assert.Equal((int)j["freeCreations"]!, c.FreeCreations);
        Assert.Equal((int)j["maxReprocesses"]!, c.MaxReprocesses);
        Assert.Equal((int)j["renewalGraceDays"]!, c.RenewalGraceDays);
        var ps = j["products"]!.AsArray();
        Assert.Equal(ps.Count, c.Products.Count);
        for (var i = 0; i < ps.Count; i++)
        {
            var p = ps[i]!;
            var q = c.Products[i];
            Assert.Equal((string)p["id"]!, q.Id);
            Assert.Equal((string)p["kind"]!, q.Kind.Key());
            Assert.Equal((string)p["title"]!, q.Title);
            Assert.Equal((string)p["blurb"]!, q.Blurb);
            Assert.Equal((int)p["credits"]!, q.Credits);
            Assert.Equal((int)p["priceCents"]!, q.PriceCents);
        }
    }

    [Theory]
    [InlineData("2026-01-31T12:00:00Z", 1, "2026-02-28T12:00:00Z")]
    [InlineData("2026-01-31T12:00:00Z", 2, "2026-03-31T12:00:00Z")]
    [InlineData("2028-01-30T00:00:00Z", 1, "2028-02-29T00:00:00Z")]
    public void AddMonthsClampsToTheLastDay(string from, int n, string expected) =>
        Assert.Equal(expected, Iso(BillingTime.AddMonths(T(from), n)));

    [Theory]
    [InlineData("2026-02-28T11:59:59Z", 0)]
    [InlineData("2026-02-28T12:00:00Z", 1)]
    [InlineData("2026-03-31T12:00:00Z", 2)]
    [InlineData("2025-12-01T00:00:00Z", 0)]
    public void PeriodIndexCountsWholeMonths(string now, int expected) =>
        Assert.Equal(expected, BillingTime.PeriodIndex(T("2026-01-31T12:00:00Z"), T(now)));

    public static IEnumerable<object[]> Scenarios() =>
        Shared("scenarios.json")["scenarios"]!.AsArray().Select(s => new object[] { (string)s!["name"]! });

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void SharedScenario(string name)
    {
        var sc = Shared("scenarios.json")["scenarios"]!.AsArray().First(s => (string)s!["name"]! == name)!;
        var w = new Wallet();
        var i = 0;
        foreach (var s in sc["steps"]!.AsArray())
        {
            i++;
            var op = (string)s!["op"]!;
            var where = $"step {i} ({op} {(string?)s["id"]})";
            if (op == "balance")
            {
                var b = w.GetBalance(T((string)s["at"]!));
                var flat = new Dictionary<string, object?>
                {
                    ["freeLeft"] = b.FreeLeft, ["credits"] = b.Credits,
                    ["subActive"] = b.Subscription?.Active ?? false, ["subLeft"] = b.Subscription?.Left ?? 0,
                    ["paidThrough"] = b.Subscription is { } st ? Iso(st.PaidThrough) : null, ["autoRenew"] = b.Subscription?.AutoRenew,
                };
                foreach (var (k, v) in s["expect"]!.AsObject())
                {
                    object? expected = v switch
                    {
                        null => null,
                        JsonValue jv when jv.TryGetValue<bool>(out var bo) => bo,
                        JsonValue jv when jv.TryGetValue<int>(out var n) => n,
                        _ => (string)v!,
                    };
                    Assert.True(Equals(expected, flat[k]), $"{where}: {k} expected {expected ?? "null"}, got {flat[k] ?? "null"}");
                }
                continue;
            }
            var r = op switch
            {
                "pay" => w.ApplyPayment(new Receipt((string)s["id"]!, (string)s["product"]!, (int)s["amountCents"]!, (string)s["currency"]!, (string)s["status"]!, T((string)s["at"]!))),
                "create" => w.StartCreation((string)s["id"]!, T((string)s["at"]!)),
                "reprocess" => w.Reprocess((string)s["id"]!),
                "refundCreation" => w.RefundCreation((string)s["id"]!, T((string)s["at"]!)),
                "refundPayment" => w.RefundPayment((string)s["id"]!),
                "cancel" => w.CancelSubscription(),
                _ => throw new InvalidOperationException(op),
            };
            Assert.True((string)s["expect"]! == r.Code, $"{where}: expected {(string)s["expect"]!}, got {r.Code}");
            if (s["source"] is { } src) Assert.True((string)src! == r.Source?.Key(), $"{where}: source {(string)src!} vs {r.Source}");
            var json = w.ToJson();
            Assert.Equal(json, Wallet.FromJson(json).ToJson());
        }
    }

    [Fact]
    public void WebSavedWalletLoads()
    {
        var w = Wallet.FromJson("""{"freeUsed":1,"credits":4,"sub":{"productId":"creator_monthly","anchor":1777593600000,"paidPeriods":1,"autoRenew":true,"usedPeriod":0,"used":2},"payments":{"p":{"productId":"pack5","credits":5,"refunded":false}},"creations":{"c":{"source":"credit","period":0,"runs":2,"refunded":false}}}""");
        var b = w.GetBalance(1777593600000 + 1000);
        Assert.Equal(0, b.FreeLeft);
        Assert.Equal(4, b.Credits);
        Assert.Equal(8, b.Subscription?.Left);
        Assert.Equal("already_applied", w.ApplyPayment(new Receipt("p", "pack5", 399, "USD", "COMPLETED", 0)).Code);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("x")]
    [InlineData("42")]
    [InlineData("""{"credits":-5,"freeUsed":"a","sub":{"productId":1},"payments":{"p":null},"creations":{"c":{"source":"stolen"}}}""")]
    public void DamagedWalletLoadsClean(string? json) => Assert.Equal(new Wallet().ToJson(), Wallet.FromJson(json).ToJson());

    [Fact]
    public void StoreRoundTripsAndSurvivesAMissingFile()
    {
        var dir = Path.Combine(Path.GetTempPath(), "sb-wallet-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new WalletStore(Path.Combine(dir, "wallet.json"));
            Assert.Equal(new Wallet().ToJson(), store.Load().ToJson());
            var w = new Wallet();
            w.ApplyPayment(new Receipt("p1", "pack5", 399, "USD", "COMPLETED", 0));
            store.Save(w);
            Assert.Equal(5, store.Load().Credits);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}
