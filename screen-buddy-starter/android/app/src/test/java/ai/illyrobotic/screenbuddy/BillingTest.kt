package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.billing.BillingResult
import ai.illyrobotic.screenbuddy.billing.Catalog
import ai.illyrobotic.screenbuddy.billing.ProductKind
import ai.illyrobotic.screenbuddy.billing.Receipt
import ai.illyrobotic.screenbuddy.billing.Wallet
import ai.illyrobotic.screenbuddy.billing.addMonths
import ai.illyrobotic.screenbuddy.billing.periodIndex
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.Instant

/** Replays billing/scenarios.json, the same vectors the web and Windows tests use. */
class BillingTest {
    // Unit tests run in android/app, so the shared folder is two levels up.
    private fun shared(name: String) = JSONObject(File("../../billing/$name").readText())
    private fun t(iso: String) = Instant.parse(iso).toEpochMilli()
    private fun iso(ms: Long) = Instant.ofEpochMilli(ms).toString()

    @Test fun catalogIsTheSharedOne() {
        val j = shared("catalog.json")
        val c = Catalog.DEFAULT
        assertEquals(j.getInt("version"), c.version)
        assertEquals(j.getString("currency"), c.currency)
        assertEquals(j.getInt("freeCreations"), c.freeCreations)
        assertEquals(j.getInt("maxReprocesses"), c.maxReprocesses)
        assertEquals(j.getInt("renewalGraceDays"), c.renewalGraceDays)
        val ps = j.getJSONArray("products")
        assertEquals(ps.length(), c.products.size)
        for (i in 0 until ps.length()) {
            val p = ps.getJSONObject(i)
            val q = c.products[i]
            assertEquals(p.getString("id"), q.id)
            assertEquals(p.getString("kind"), q.kind.key)
            assertEquals(p.getString("title"), q.title)
            assertEquals(p.getString("blurb"), q.blurb)
            assertEquals(p.getInt("credits"), q.credits)
            assertEquals(p.getInt("priceCents"), q.priceCents)
        }
    }

    @Test fun addMonthsClampsToTheLastDay() {
        assertEquals("2026-02-28T12:00:00Z", iso(addMonths(t("2026-01-31T12:00:00Z"), 1)))
        assertEquals("2026-03-31T12:00:00Z", iso(addMonths(t("2026-01-31T12:00:00Z"), 2)))
        assertEquals("2028-02-29T00:00:00Z", iso(addMonths(t("2028-01-30T00:00:00Z"), 1)))
    }

    @Test fun periodIndexCountsWholeMonths() {
        val a = t("2026-01-31T12:00:00Z")
        assertEquals(0, periodIndex(a, t("2026-02-28T11:59:59Z")))
        assertEquals(1, periodIndex(a, t("2026-02-28T12:00:00Z")))
        assertEquals(2, periodIndex(a, t("2026-03-31T12:00:00Z")))
        assertEquals(0, periodIndex(a, t("2025-12-01T00:00:00Z")))
    }

    @Test fun sharedScenarios() {
        val scenarios = shared("scenarios.json").getJSONArray("scenarios")
        for (i in 0 until scenarios.length()) {
            val sc = scenarios.getJSONObject(i)
            val w = Wallet()
            val steps = sc.getJSONArray("steps")
            for (j in 0 until steps.length()) {
                val s = steps.getJSONObject(j)
                val op = s.getString("op")
                val where = "${sc.getString("name")}, step ${j + 1} ($op ${s.optString("id")})"
                if (op == "balance") {
                    val b = w.balance(t(s.getString("at")))
                    val flat = mapOf(
                        "freeLeft" to b.freeLeft, "credits" to b.credits,
                        "subActive" to (b.subscription?.active ?: false), "subLeft" to (b.subscription?.left ?: 0),
                        "paidThrough" to b.subscription?.let { iso(it.paidThrough) }, "autoRenew" to b.subscription?.autoRenew,
                    )
                    val expect = s.getJSONObject("expect")
                    for (k in expect.keys()) {
                        val v = expect.get(k).let { if (it == JSONObject.NULL) null else it }
                        assertEquals("$where: $k", v, flat[k])
                    }
                    continue
                }
                val r: BillingResult = when (op) {
                    "pay" -> w.applyPayment(Receipt(s.getString("id"), s.getString("product"), s.getInt("amountCents"), s.getString("currency"), s.getString("status"), t(s.getString("at"))))
                    "create" -> w.startCreation(s.getString("id"), t(s.getString("at")))
                    "reprocess" -> w.reprocess(s.getString("id"))
                    "refundCreation" -> w.refundCreation(s.getString("id"), t(s.getString("at")))
                    "refundPayment" -> w.refundPayment(s.getString("id"))
                    "cancel" -> w.cancelSubscription()
                    else -> error("unknown op $op")
                }
                assertEquals(where, s.getString("expect"), r.code)
                if (s.has("source")) assertEquals("$where: source", s.getString("source"), r.source?.key)
                val json = w.toJson().toString()
                assertEquals("$where: round trip", json, Wallet.fromJson(json).toJson().toString())
            }
        }
    }

    @Test fun webSavedWalletLoads() {
        // What web/js/billing.js writes (anchor as a plain number) must load here, so wallets can move between apps.
        val w = Wallet.fromJson("""{"freeUsed":1,"credits":4,"sub":{"productId":"creator_monthly","anchor":1777593600000,"paidPeriods":1,"autoRenew":true,"usedPeriod":0,"used":2},"payments":{"p":{"productId":"pack5","credits":5,"refunded":false}},"creations":{"c":{"source":"credit","period":0,"runs":2,"refunded":false}}}""")
        val b = w.balance(1777593600000 + 1000)
        assertEquals(0, b.freeLeft)
        assertEquals(4, b.credits)
        assertEquals(8, b.subscription?.left)
        assertEquals("already_applied", w.applyPayment(Receipt("p", "pack5", 399, "USD", "COMPLETED", 0)).code)
    }

    @Test fun damagedWalletLoadsClean() {
        for (bad in listOf(null, "", "x", "42", """{"credits":-5,"freeUsed":"a","sub":{"productId":1},"payments":{"p":null},"creations":{"c":{"source":"stolen"}}}""")) {
            val w = Wallet.fromJson(bad)
            assertEquals(Wallet().toJson().toString(), w.toJson().toString())
        }
    }

    @Test fun subscriptionIsTheOnlySubscriptionProduct() =
        assertEquals(listOf("creator_monthly"), Catalog.DEFAULT.products.filter { it.kind == ProductKind.Subscription }.map { it.id })
}
