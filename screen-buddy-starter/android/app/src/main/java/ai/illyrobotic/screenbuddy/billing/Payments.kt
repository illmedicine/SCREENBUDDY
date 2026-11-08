package ai.illyrobotic.screenbuddy.billing

import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import java.util.UUID

// Payment providers: the one place where money is taken. The rest of the app only sees a Receipt.
//
// checkout() must return a Receipt only after the payment is captured (status COMPLETED), throw
// PaymentException(cancelled = true) when the buyer backs out, and PaymentException for anything else. The wallet
// re-checks product, amount and currency against the catalog and ignores a receipt id it has already applied, so
// retrying is safe. Receipt fields are described in web/js/payments.js and billing/README.md.
//
// Until sign-in and the server exist, receipts are applied on the phone, so a determined user could fake one.
// Before real money: verify each order on the server (PayPal Orders API or webhooks) and keep the wallet there.

class PaymentException(message: String, val cancelled: Boolean = false) : Exception(message)

interface PaymentProvider {
    val name: String
    /** False until checkout really takes payments; the store disables its buttons. */
    val ready: Boolean
    suspend fun checkout(activity: Activity, product: Product): Receipt
    /** Turns off renewal of the Creator plan at the provider. */
    suspend fun cancelSubscription(activity: Activity)
}

/** Connect your PayPal account here. */
object PayPalPaymentProvider : PaymentProvider {
    /** REST app client id (sandbox first). */
    const val CLIENT_ID = ""
    /** Billing plan ids by product id: the Creator plan, $2.99 / month. */
    val PLAN_IDS = mapOf("creator_monthly" to "")

    override val name = "PayPal"
    override val ready = false

    override suspend fun checkout(activity: Activity, product: Product): Receipt {
        // Wire PayPal here: one-off packs as an order for product.priceCents in Catalog.DEFAULT.currency, the
        // Creator plan as a subscription on PLAN_IDS[product.id]. Return the Receipt described at the top of this file.
        throw PaymentException("PayPal checkout isn't connected yet (${product.id}).")
    }

    override suspend fun cancelSubscription(activity: Activity) {
        throw PaymentException("PayPal isn't connected yet.")
    }
}

/** Test payments for debug builds: no money moves. */
object DevPaymentProvider : PaymentProvider {
    override val name = "Test payments"
    override val ready = true
    override suspend fun checkout(activity: Activity, product: Product) =
        Receipt("dev-${UUID.randomUUID()}", product.id, product.priceCents, Catalog.DEFAULT.currency, "COMPLETED", System.currentTimeMillis())
    override suspend fun cancelSubscription(activity: Activity) {}
}

/** Test payments in debug builds, PayPal in release builds. */
fun pickProvider(context: Context): PaymentProvider =
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) DevPaymentProvider else PayPalPaymentProvider

/** The wallet on this phone, until it moves to the signed-in account on the server. */
class WalletStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("screenbuddy_billing", Context.MODE_PRIVATE)
    fun load(): Wallet = Wallet.fromJson(sp.getString(KEY, null))
    fun save(wallet: Wallet) = sp.edit().putString(KEY, wallet.toJson().toString()).apply()
    private companion object { const val KEY = "wallet" }
}
