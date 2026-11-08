package ai.illyrobotic.screenbuddy.billing

import org.json.JSONException
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.max

// The pricing model and the wallet engine: what a user can buy, what they have left, and what making a buddy costs.
// Mirrors web/js/billing.js and windows/src/ScreenBuddy.Core/Billing/Wallet.cs; all three replay
// billing/scenarios.json in their tests and must agree. Catalog.DEFAULT must equal billing/catalog.json.

enum class ProductKind(val key: String) { Credits("credits"), Subscription("subscription") }

data class Product(
    val id: String,
    val kind: ProductKind,
    val title: String,
    val blurb: String,
    /** Buddies it buys; for a subscription, buddies per month. */
    val credits: Int,
    val priceCents: Int,
)

data class Catalog(
    val version: Int,
    val currency: String,
    val freeCreations: Int,
    val maxReprocesses: Int,
    val renewalGraceDays: Int,
    val products: List<Product>,
) {
    fun product(id: String?): Product? = products.firstOrNull { it.id == id }

    companion object {
        val DEFAULT = Catalog(
            version = 1,
            currency = "USD",
            freeCreations = 1,
            maxReprocesses = 3,
            renewalGraceDays = 3,
            products = listOf(
                Product("single", ProductKind.Credits, "1 buddy", "Make one buddy from your own video.", 1, 99),
                Product("pack5", ProductKind.Credits, "5 buddies", "Five buddies. Credits never expire.", 5, 399),
                Product("creator_monthly", ProductKind.Subscription, "Creator plan", "10 buddies every month and priority processing. Cancel anytime.", 10, 299),
            ),
        )
    }
}

/** A captured payment, as the payment provider reports it. [at] is epoch milliseconds. */
data class Receipt(val id: String, val productId: String, val amountCents: Int, val currency: String, val status: String, val at: Long)

enum class Source(val key: String) {
    Free("free"), Credit("credit"), Subscription("subscription");
    companion object { fun fromKey(k: String?) = entries.firstOrNull { it.key == k } }
}

/** [code] is "ok", "already_applied" or an error such as "no_credits"; the same codes on every platform. */
data class BillingResult(val ok: Boolean, val code: String, val source: Source? = null) {
    companion object {
        val OK = BillingResult(true, "ok")
        fun fail(code: String) = BillingResult(false, code)
    }
}

data class SubscriptionStatus(val productId: String, val active: Boolean, val left: Int, val paidThrough: Long, val autoRenew: Boolean)
data class Balance(val freeLeft: Int, val credits: Int, val subscription: SubscriptionStatus?, val total: Int)

private const val DAY_MS = 86_400_000L

/** [ms] plus [n] calendar months in UTC. A day that doesn't exist in the target month becomes its last day (Jan 31 + 1 = Feb 28). */
fun addMonths(ms: Long, n: Int): Long =
    Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).plusMonths(n.toLong()).toInstant().toEpochMilli()

/** Which monthly period [now] falls in, counting from [anchor] (0 = the first month). */
fun periodIndex(anchor: Long, now: Long): Int {
    val a = Instant.ofEpochMilli(anchor).atZone(ZoneOffset.UTC)
    val b = Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC)
    var k = (b.year - a.year) * 12 + (b.monthValue - a.monthValue)
    while (k > 0 && addMonths(anchor, k) > now) k--
    return max(0, k)
}

/**
 * One user's balance and history. Spending order for a new buddy: this month's plan allowance (it expires), then the
 * free buddy, then bought credits (they never expire). Every method checks its input and returns a [BillingResult]
 * instead of throwing, so a bad receipt or a double tap can't corrupt the wallet. Not thread-safe: use it from one thread.
 */
class Wallet(val catalog: Catalog = Catalog.DEFAULT) {
    private class Sub(val productId: String, val anchor: Long, var paidPeriods: Int, var autoRenew: Boolean, var usedPeriod: Int, var used: Int)
    private class Payment(val productId: String, val credits: Int, var refunded: Boolean)
    private class Creation(val source: Source, val period: Int, var runs: Int, var refunded: Boolean)

    var freeUsed = 0; private set
    var credits = 0; private set
    private var sub: Sub? = null
    private val payments = LinkedHashMap<String, Payment>()
    private val creations = LinkedHashMap<String, Creation>()

    fun paidThrough(): Long? = sub?.let { addMonths(it.anchor, it.paidPeriods) }

    /** Plan allowance left at [now], or null when there's no active plan. */
    private fun subLeft(now: Long): Int? {
        val s = sub ?: return null
        if (now < s.anchor || now >= paidThrough()!!) return null
        val perPeriod = catalog.product(s.productId)?.credits ?: 0
        val used = if (s.usedPeriod == periodIndex(s.anchor, now)) s.used else 0
        return max(0, perPeriod - used)
    }

    fun balance(now: Long): Balance {
        val freeLeft = max(0, catalog.freeCreations - freeUsed)
        val left = subLeft(now)
        val status = sub?.let { SubscriptionStatus(it.productId, left != null, left ?: 0, paidThrough()!!, it.autoRenew) }
        return Balance(freeLeft, credits, status, freeLeft + credits + (left ?: 0))
    }

    /**
     * Adds what a completed payment bought. Only call this with a receipt your payment provider (or, later, the server)
     * has confirmed. Applying the same receipt id twice is a no-op ("already_applied").
     */
    fun applyPayment(r: Receipt): BillingResult {
        if (r.id.isEmpty()) return BillingResult.fail("invalid_receipt")
        if (payments.containsKey(r.id)) return BillingResult(true, "already_applied")
        val p = catalog.product(r.productId) ?: return BillingResult.fail("unknown_product")
        if (r.status != "COMPLETED") return BillingResult.fail("not_completed")
        if (r.currency != catalog.currency) return BillingResult.fail("wrong_currency")
        if (r.amountCents != p.priceCents) return BillingResult.fail("wrong_amount")

        if (p.kind == ProductKind.Credits) {
            credits += p.credits
            payments[r.id] = Payment(p.id, p.credits, false)
            return BillingResult.OK
        }
        val s = sub
        if (s != null && s.productId == p.id && r.at < paidThrough()!! + catalog.renewalGraceDays * DAY_MS) {
            s.paidPeriods += 1                          // a renewal: the plan continues from where it was paid up to
            s.autoRenew = true
        } else {
            sub = Sub(p.id, r.at, 1, true, 0, 0)
        }
        payments[r.id] = Payment(p.id, 0, false)
        return BillingResult.OK
    }

    /** Spends one buddy for creation [id]. Call before uploading the video. */
    fun startCreation(id: String, now: Long): BillingResult {
        if (id.isEmpty()) return BillingResult.fail("invalid_id")
        if (creations.containsKey(id)) return BillingResult.fail("duplicate_creation")
        val s = sub
        val left = subLeft(now)
        val (source, period) = when {
            s != null && left != null && left > 0 -> {
                val k = periodIndex(s.anchor, now)
                s.used = if (s.usedPeriod == k) s.used + 1 else 1
                s.usedPeriod = k
                Source.Subscription to k
            }
            freeUsed < catalog.freeCreations -> { freeUsed += 1; Source.Free to 0 }
            credits > 0 -> { credits -= 1; Source.Credit to 0 }
            else -> return BillingResult.fail("no_credits")
        }
        creations[id] = Creation(source, period, 1, false)
        return BillingResult(true, "ok", source)
    }

    /** A free re-do of creation [id]. Limited per buddy so one purchase can't become endless GPU runs. */
    fun reprocess(id: String): BillingResult {
        val c = creations[id] ?: return BillingResult.fail("unknown_creation")
        if (c.refunded) return BillingResult.fail("refunded")
        if (c.runs >= 1 + catalog.maxReprocesses) return BillingResult.fail("reprocess_limit")
        c.runs += 1
        return BillingResult.OK
    }

    /** Gives back the buddy spent on creation [id], for when processing failed on our side. */
    fun refundCreation(id: String, now: Long): BillingResult {
        val c = creations[id] ?: return BillingResult.fail("unknown_creation")
        if (c.refunded) return BillingResult.fail("already_refunded")
        c.refunded = true
        val s = sub
        when {
            c.source == Source.Free -> freeUsed = max(0, freeUsed - 1)
            c.source == Source.Credit -> credits += 1
            s != null && subLeft(now) != null && s.usedPeriod == c.period && periodIndex(s.anchor, now) == c.period ->
                s.used = max(0, s.used - 1)
            else -> credits += 1                          // its month is over, so it comes back as a credit that doesn't expire
        }
        return BillingResult.OK
    }

    /** The provider refunded or reversed payment [id]: take back what it bought (credits already spent stay spent). */
    fun refundPayment(id: String): BillingResult {
        val p = payments[id] ?: return BillingResult.fail("unknown_payment")
        if (p.refunded) return BillingResult.fail("already_refunded")
        p.refunded = true
        if (catalog.product(p.productId)?.kind == ProductKind.Subscription) {
            val s = sub
            if (s != null && s.productId == p.productId) {
                s.paidPeriods -= 1
                if (s.paidPeriods <= 0) sub = null
            }
        } else {
            credits = max(0, credits - p.credits)
        }
        return BillingResult.OK
    }

    /** The user turned off renewal. The plan keeps working until it's paid up to. */
    fun cancelSubscription(): BillingResult {
        val s = sub ?: return BillingResult.fail("no_subscription")
        s.autoRenew = false
        return BillingResult.OK
    }

    /** The same JSON shape as the web wallet, so a saved wallet can move to the server unchanged. */
    fun toJson(): JSONObject = JSONObject().apply {
        put("freeUsed", freeUsed)
        put("credits", credits)
        put("sub", sub?.let {
            JSONObject().put("productId", it.productId).put("anchor", it.anchor).put("paidPeriods", it.paidPeriods)
                .put("autoRenew", it.autoRenew).put("usedPeriod", it.usedPeriod).put("used", it.used)
        } ?: JSONObject.NULL)
        put("payments", JSONObject().apply {
            for ((id, p) in payments) put(id, JSONObject().put("productId", p.productId).put("credits", p.credits).put("refunded", p.refunded))
        })
        put("creations", JSONObject().apply {
            for ((id, c) in creations) put(id, JSONObject().put("source", c.source.key).put("period", c.period).put("runs", c.runs).put("refunded", c.refunded))
        })
    }

    companion object {
        private fun JSONObject.count(key: String): Int {
            val v = opt(key)
            return if (v is Int && v >= 0) v else if (v is Long && v in 0..Int.MAX_VALUE) v.toInt() else 0
        }

        /** Reads what [toJson] wrote. Anything damaged is dropped rather than failing, so the app always starts. */
        fun fromJson(text: String?, catalog: Catalog = Catalog.DEFAULT): Wallet {
            val w = Wallet(catalog)
            val o = try { JSONObject(text ?: return w) } catch (_: JSONException) { return w }
            w.freeUsed = o.count("freeUsed")
            w.credits = o.count("credits")
            o.optJSONObject("sub")?.let { s ->
                val productId = s.opt("productId") as? String
                val anchor = (s.opt("anchor") as? Number)?.toLong()
                val periods = s.count("paidPeriods")
                if (productId != null && anchor != null && periods > 0) {
                    w.sub = Sub(productId, anchor, periods, s.opt("autoRenew") != false, s.count("usedPeriod"), s.count("used"))
                }
            }
            o.optJSONObject("payments")?.let { ps ->
                for (id in ps.keys()) {
                    val p = ps.optJSONObject(id) ?: continue
                    val productId = p.opt("productId") as? String ?: continue
                    w.payments[id] = Payment(productId, p.count("credits"), p.optBoolean("refunded"))
                }
            }
            o.optJSONObject("creations")?.let { cs ->
                for (id in cs.keys()) {
                    val c = cs.optJSONObject(id) ?: continue
                    val source = Source.fromKey(c.opt("source") as? String) ?: continue
                    w.creations[id] = Creation(source, c.count("period"), max(1, c.count("runs")), c.optBoolean("refunded"))
                }
            }
            return w
        }
    }
}
