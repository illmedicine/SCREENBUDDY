using System.Text.Json;
using System.Text.Json.Nodes;

namespace ScreenBuddy.Core.Billing;

// The pricing model and the wallet engine: what a user can buy, what they have left, and what making a buddy costs.
// Mirrors web/js/billing.js and android/.../billing/Wallet.kt; all three replay billing/scenarios.json in their
// tests and must agree. Catalog.Default must equal billing/catalog.json.

public enum ProductKind { Credits, Subscription }

/// <param name="Credits">Buddies it buys; for a subscription, buddies per month.</param>
public sealed record Product(string Id, ProductKind Kind, string Title, string Blurb, int Credits, int PriceCents);

public sealed record Catalog(int Version, string Currency, int FreeCreations, int MaxReprocesses, int RenewalGraceDays, IReadOnlyList<Product> Products)
{
    public Product? Find(string? id) => Products.FirstOrDefault(p => p.Id == id);

    public static readonly Catalog Default = new(
        Version: 1,
        Currency: "USD",
        FreeCreations: 1,
        MaxReprocesses: 3,
        RenewalGraceDays: 3,
        Products:
        [
            new("single", ProductKind.Credits, "1 buddy", "Make one buddy from your own video.", 1, 99),
            new("pack5", ProductKind.Credits, "5 buddies", "Five buddies. Credits never expire.", 5, 399),
            new("creator_monthly", ProductKind.Subscription, "Creator plan", "10 buddies every month and priority processing. Cancel anytime.", 10, 299),
        ]);
}

/// <summary>A captured payment, as the payment provider reports it. <see cref="At"/> is epoch milliseconds.</summary>
public sealed record Receipt(string Id, string ProductId, int AmountCents, string Currency, string Status, long At);

public enum Source { Free, Credit, Subscription }

/// <summary><see cref="Code"/> is "ok", "already_applied" or an error such as "no_credits"; the same codes on every platform.</summary>
public sealed record BillingResult(bool Ok, string Code, Source? Source = null)
{
    public static readonly BillingResult Success = new(true, "ok");
    public static BillingResult Fail(string code) => new(false, code);
}

public sealed record SubscriptionStatus(string ProductId, bool Active, int Left, long PaidThrough, bool AutoRenew);
public sealed record Balance(int FreeLeft, int Credits, SubscriptionStatus? Subscription, int Total);

public static class BillingKeys
{
    public static string Key(this ProductKind k) => k == ProductKind.Credits ? "credits" : "subscription";
    public static string Key(this Source s) => s switch { Source.Free => "free", Source.Credit => "credit", _ => "subscription" };
    public static Source? ParseSource(string? key) => key switch { "free" => Source.Free, "credit" => Source.Credit, "subscription" => Source.Subscription, _ => null };
}

public static class BillingTime
{
    /// <summary><paramref name="ms"/> plus <paramref name="n"/> calendar months in UTC. A day that doesn't exist in the target month becomes its last day (Jan 31 + 1 = Feb 28).</summary>
    public static long AddMonths(long ms, int n) => DateTimeOffset.FromUnixTimeMilliseconds(ms).AddMonths(n).ToUnixTimeMilliseconds();

    /// <summary>Which monthly period <paramref name="now"/> falls in, counting from <paramref name="anchor"/> (0 = the first month).</summary>
    public static int PeriodIndex(long anchor, long now)
    {
        var a = DateTimeOffset.FromUnixTimeMilliseconds(anchor);
        var b = DateTimeOffset.FromUnixTimeMilliseconds(now);
        var k = (b.Year - a.Year) * 12 + (b.Month - a.Month);
        while (k > 0 && AddMonths(anchor, k) > now) k--;
        return Math.Max(0, k);
    }
}

/// <summary>
/// One user's balance and history. Spending order for a new buddy: this month's plan allowance (it expires), then the
/// free buddy, then bought credits (they never expire). Every method checks its input and returns a <see cref="BillingResult"/>
/// instead of throwing, so a bad receipt or a double click can't corrupt the wallet. Not thread-safe.
/// </summary>
public sealed class Wallet(Catalog? catalog = null)
{
    private sealed class Sub
    {
        public required string ProductId; public required long Anchor; public int PaidPeriods; public bool AutoRenew; public int UsedPeriod; public int Used;
    }
    private sealed record Payment(string ProductId, int Credits) { public bool Refunded { get; set; } }
    private sealed record Creation(Source Source, int Period) { public int Runs { get; set; } = 1; public bool Refunded { get; set; } }

    private const long DayMs = 86_400_000;
    private Sub? _sub;
    private readonly Dictionary<string, Payment> _payments = new();
    private readonly Dictionary<string, Creation> _creations = new();

    public Catalog Catalog { get; } = catalog ?? Catalog.Default;
    public int FreeUsed { get; private set; }
    public int Credits { get; private set; }

    public long? PaidThrough() => _sub is null ? null : BillingTime.AddMonths(_sub.Anchor, _sub.PaidPeriods);

    /// <summary>Plan allowance left at <paramref name="now"/>, or null when there's no active plan.</summary>
    private int? SubLeft(long now)
    {
        if (_sub is not { } s || now < s.Anchor || now >= PaidThrough()) return null;
        var perPeriod = Catalog.Find(s.ProductId)?.Credits ?? 0;
        var used = s.UsedPeriod == BillingTime.PeriodIndex(s.Anchor, now) ? s.Used : 0;
        return Math.Max(0, perPeriod - used);
    }

    public Balance GetBalance(long now)
    {
        var freeLeft = Math.Max(0, Catalog.FreeCreations - FreeUsed);
        var left = SubLeft(now);
        var status = _sub is { } s ? new SubscriptionStatus(s.ProductId, left is not null, left ?? 0, PaidThrough()!.Value, s.AutoRenew) : null;
        return new Balance(freeLeft, Credits, status, freeLeft + Credits + (left ?? 0));
    }

    /// <summary>
    /// Adds what a completed payment bought. Only call this with a receipt your payment provider (or, later, the server)
    /// has confirmed. Applying the same receipt id twice is a no-op ("already_applied").
    /// </summary>
    public BillingResult ApplyPayment(Receipt r)
    {
        if (string.IsNullOrEmpty(r.Id)) return BillingResult.Fail("invalid_receipt");
        if (_payments.ContainsKey(r.Id)) return new BillingResult(true, "already_applied");
        if (Catalog.Find(r.ProductId) is not { } p) return BillingResult.Fail("unknown_product");
        if (r.Status != "COMPLETED") return BillingResult.Fail("not_completed");
        if (r.Currency != Catalog.Currency) return BillingResult.Fail("wrong_currency");
        if (r.AmountCents != p.PriceCents) return BillingResult.Fail("wrong_amount");

        if (p.Kind == ProductKind.Credits)
        {
            Credits += p.Credits;
            _payments[r.Id] = new Payment(p.Id, p.Credits);
            return BillingResult.Success;
        }
        if (_sub is { } s && s.ProductId == p.Id && r.At < PaidThrough() + Catalog.RenewalGraceDays * DayMs)
        {
            s.PaidPeriods += 1;                       // a renewal: the plan continues from where it was paid up to
            s.AutoRenew = true;
        }
        else
        {
            _sub = new Sub { ProductId = p.Id, Anchor = r.At, PaidPeriods = 1, AutoRenew = true };
        }
        _payments[r.Id] = new Payment(p.Id, 0);
        return BillingResult.Success;
    }

    /// <summary>Spends one buddy for creation <paramref name="id"/>. Call before uploading the video.</summary>
    public BillingResult StartCreation(string id, long now)
    {
        if (string.IsNullOrEmpty(id)) return BillingResult.Fail("invalid_id");
        if (_creations.ContainsKey(id)) return BillingResult.Fail("duplicate_creation");
        Source source;
        var period = 0;
        if (_sub is { } s && SubLeft(now) is > 0)
        {
            var k = BillingTime.PeriodIndex(s.Anchor, now);
            s.Used = s.UsedPeriod == k ? s.Used + 1 : 1;
            s.UsedPeriod = k;
            source = Source.Subscription;
            period = k;
        }
        else if (FreeUsed < Catalog.FreeCreations) { FreeUsed++; source = Source.Free; }
        else if (Credits > 0) { Credits--; source = Source.Credit; }
        else return BillingResult.Fail("no_credits");
        _creations[id] = new Creation(source, period);
        return new BillingResult(true, "ok", source);
    }

    /// <summary>A free re-do of creation <paramref name="id"/>. Limited per buddy so one purchase can't become endless GPU runs.</summary>
    public BillingResult Reprocess(string id)
    {
        if (!_creations.TryGetValue(id, out var c)) return BillingResult.Fail("unknown_creation");
        if (c.Refunded) return BillingResult.Fail("refunded");
        if (c.Runs >= 1 + Catalog.MaxReprocesses) return BillingResult.Fail("reprocess_limit");
        c.Runs++;
        return BillingResult.Success;
    }

    /// <summary>Gives back the buddy spent on creation <paramref name="id"/>, for when processing failed on our side.</summary>
    public BillingResult RefundCreation(string id, long now)
    {
        if (!_creations.TryGetValue(id, out var c)) return BillingResult.Fail("unknown_creation");
        if (c.Refunded) return BillingResult.Fail("already_refunded");
        c.Refunded = true;
        if (c.Source == Source.Free) FreeUsed = Math.Max(0, FreeUsed - 1);
        else if (c.Source == Source.Credit) Credits++;
        else if (_sub is { } s && SubLeft(now) is not null && s.UsedPeriod == c.Period && BillingTime.PeriodIndex(s.Anchor, now) == c.Period)
            s.Used = Math.Max(0, s.Used - 1);
        else Credits++;                                // its month is over, so it comes back as a credit that doesn't expire
        return BillingResult.Success;
    }

    /// <summary>The provider refunded or reversed payment <paramref name="id"/>: take back what it bought (credits already spent stay spent).</summary>
    public BillingResult RefundPayment(string id)
    {
        if (!_payments.TryGetValue(id, out var p)) return BillingResult.Fail("unknown_payment");
        if (p.Refunded) return BillingResult.Fail("already_refunded");
        p.Refunded = true;
        if (Catalog.Find(p.ProductId)?.Kind == ProductKind.Subscription)
        {
            if (_sub is { } s && s.ProductId == p.ProductId && --s.PaidPeriods <= 0) _sub = null;
        }
        else Credits = Math.Max(0, Credits - p.Credits);
        return BillingResult.Success;
    }

    /// <summary>The user turned off renewal. The plan keeps working until it's paid up to.</summary>
    public BillingResult CancelSubscription()
    {
        if (_sub is null) return BillingResult.Fail("no_subscription");
        _sub.AutoRenew = false;
        return BillingResult.Success;
    }

    // ---- saving: the same JSON shape as the web and Android wallets ---------------------------------------------

    public string ToJson()
    {
        var payments = new JsonObject();
        foreach (var (id, p) in _payments)
            payments[id] = new JsonObject { ["productId"] = p.ProductId, ["credits"] = p.Credits, ["refunded"] = p.Refunded };
        var creations = new JsonObject();
        foreach (var (id, c) in _creations)
            creations[id] = new JsonObject { ["source"] = c.Source.Key(), ["period"] = c.Period, ["runs"] = c.Runs, ["refunded"] = c.Refunded };
        return new JsonObject
        {
            ["freeUsed"] = FreeUsed,
            ["credits"] = Credits,
            ["sub"] = _sub is { } s
                ? new JsonObject { ["productId"] = s.ProductId, ["anchor"] = s.Anchor, ["paidPeriods"] = s.PaidPeriods, ["autoRenew"] = s.AutoRenew, ["usedPeriod"] = s.UsedPeriod, ["used"] = s.Used }
                : null,
            ["payments"] = payments,
            ["creations"] = creations,
        }.ToJsonString();
    }

    private static int Count(JsonNode? n) =>
        n is JsonValue v && v.TryGetValue<long>(out var l) && l is >= 0 and <= int.MaxValue ? (int)l : 0;

    private static bool Flag(JsonNode? n, bool fallback) => n is JsonValue v && v.TryGetValue<bool>(out var b) ? b : fallback;

    private static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>Reads what <see cref="ToJson"/> wrote. Anything damaged is dropped rather than failing, so the app always starts.</summary>
    public static Wallet FromJson(string? json, Catalog? catalog = null)
    {
        var w = new Wallet(catalog);
        JsonObject? o;
        try { o = string.IsNullOrEmpty(json) ? null : JsonNode.Parse(json) as JsonObject; }
        catch (JsonException) { o = null; }
        if (o is null) return w;

        w.FreeUsed = Count(o["freeUsed"]);
        w.Credits = Count(o["credits"]);
        if (o["sub"] is JsonObject s && Text(s["productId"]) is { } productId && s["anchor"] is JsonValue av && av.TryGetValue<long>(out var anchor) && Count(s["paidPeriods"]) > 0)
            w._sub = new Sub
            {
                ProductId = productId, Anchor = anchor, PaidPeriods = Count(s["paidPeriods"]), AutoRenew = Flag(s["autoRenew"], true),
                UsedPeriod = Count(s["usedPeriod"]), Used = Count(s["used"]),
            };
        if (o["payments"] is JsonObject ps)
            foreach (var (id, n) in ps)
                if (n is JsonObject p && Text(p["productId"]) is { } pid)
                    w._payments[id] = new Payment(pid, Count(p["credits"])) { Refunded = Flag(p["refunded"], false) };
        if (o["creations"] is JsonObject cs)
            foreach (var (id, n) in cs)
                if (n is JsonObject c && BillingKeys.ParseSource(Text(c["source"])) is { } source)
                    w._creations[id] = new Creation(source, Count(c["period"])) { Runs = Math.Max(1, Count(c["runs"])), Refunded = Flag(c["refunded"], false) };
        return w;
    }
}

/// <summary>The wallet on this PC, until it moves to the signed-in account on the server. A damaged file gives an empty wallet.</summary>
public sealed class WalletStore(string path)
{
    public Wallet Load()
    {
        try { return Wallet.FromJson(File.ReadAllText(path)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return new Wallet(); }
    }

    public void Save(Wallet wallet)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, wallet.ToJson());
        File.Move(tmp, path, overwrite: true);
    }
}
