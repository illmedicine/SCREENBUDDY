package ai.illyrobotic.screenbuddy.billing

import android.content.Context
import android.content.pm.ApplicationInfo
import java.util.UUID

// The Android app sells nothing. Buddies, credits and the Creator plan are bought on the web, and the Android app
// spends what the signed-in account already has. This keeps the app outside Google Play Billing: under Play's
// payments policy an app that sells digital goods must use Play Billing, and an app that doesn't sell must not show
// prices, buy buttons or links/instructions that lead to buying elsewhere. Keep it that way in this app's UI.
//
// Until Google sign-in and the server exist, the wallet lives on this phone, so it only ever holds the free buddy
// (and test credits in debug builds). Later: load the account's wallet from the server, keep this file as a cache.

/** The wallet on this phone, until it moves to the signed-in account on the server. */
class WalletStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("screenbuddy_billing", Context.MODE_PRIVATE)
    fun load(): Wallet = Wallet.fromJson(sp.getString(KEY, null))
    fun save(wallet: Wallet) = sp.edit().putString(KEY, wallet.toJson().toString()).apply()
    private companion object { const val KEY = "wallet" }
}

/** Debug builds only: lets you fill and spend the wallet by hand to check the balance card. No money involved. */
object TestWallet {
    fun enabled(context: Context) = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    /** Adds a test purchase of [productId], as if it had been bought on the web. */
    fun grant(wallet: Wallet, productId: String, now: Long = System.currentTimeMillis()): BillingResult {
        val p = wallet.catalog.product(productId) ?: return BillingResult.fail("unknown_product")
        return wallet.applyPayment(Receipt("test-${UUID.randomUUID()}", p.id, p.priceCents, wallet.catalog.currency, "COMPLETED", now))
    }

    /** Spends one buddy, as making a buddy will. */
    fun spend(wallet: Wallet, now: Long = System.currentTimeMillis()) = wallet.startCreation("test-${UUID.randomUUID()}", now)
}
