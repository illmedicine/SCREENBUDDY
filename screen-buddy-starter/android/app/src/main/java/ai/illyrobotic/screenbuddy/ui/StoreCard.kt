package ai.illyrobotic.screenbuddy.ui

import ai.illyrobotic.screenbuddy.billing.Catalog
import ai.illyrobotic.screenbuddy.billing.DevPaymentProvider
import ai.illyrobotic.screenbuddy.billing.PaymentException
import ai.illyrobotic.screenbuddy.billing.Product
import ai.illyrobotic.screenbuddy.billing.ProductKind
import ai.illyrobotic.screenbuddy.billing.WalletStore
import ai.illyrobotic.screenbuddy.billing.pickProvider
import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency

private val MESSAGES = mapOf(
    "already_applied" to "That payment was already added.",
    "unknown_product" to "That item isn't for sale any more.",
    "not_completed" to "The payment didn't go through, so nothing was added.",
    "wrong_amount" to "The amount paid didn't match the price. Nothing was added; contact support if you were charged.",
    "wrong_currency" to "The payment was in the wrong currency. Nothing was added; contact support if you were charged.",
    "invalid_receipt" to "The payment couldn't be confirmed. Nothing was added; contact support if you were charged.",
)

fun formatPrice(cents: Int, currency: String = Catalog.DEFAULT.currency): String =
    NumberFormat.getCurrencyInstance().apply { this.currency = Currency.getInstance(currency) }.format(cents / 100.0)

private fun day(ms: Long): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(ms))

private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

/** What's left to spend on making buddies, and the three ways to buy more. */
@Composable
fun StoreCard(snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { WalletStore(context) }
    val provider = remember { pickProvider(context) }
    val wallet = remember { store.load() }
    var version by remember { mutableIntStateOf(0) }       // bumped after every change, so the card redraws
    var busy by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }

    val b = remember(version, now) { wallet.balance(now) }

    fun run(block: suspend (Activity) -> String?) {
        val activity = context as? Activity ?: return
        busy = true
        scope.launch {
            val message = try { block(activity) } catch (e: PaymentException) {
                if (e.cancelled) null else e.message
            } catch (e: Exception) {
                "Checkout failed. Nothing was charged."
            }
            busy = false
            now = System.currentTimeMillis()
            version++
            message?.let { snackbar.showSnackbar(it) }
        }
    }

    fun buy(p: Product) = run { activity ->
        val r = wallet.applyPayment(provider.checkout(activity, p))
        if (!r.ok) MESSAGES[r.code] ?: "The payment couldn't be added."
        else {
            store.save(wallet)
            when {
                r.code == "already_applied" -> MESSAGES.getValue("already_applied")
                p.kind == ProductKind.Subscription -> "You're on the Creator plan: ${p.credits} buddies a month."
                else -> "Added ${plural(p.credits, "buddy", "buddies")}."
            }
        }
    }

    fun stopRenewal() = run { activity ->
        provider.cancelSubscription(activity)
        wallet.cancelSubscription()
        store.save(wallet)
        "Renewal is off. Your plan keeps working until ${day(wallet.paidThrough() ?: now)}."
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Make buddies from your own videos", style = MaterialTheme.typography.titleSmall)
            Text(
                "The app is free and your first buddy is on us. After that, pay per buddy or join the Creator plan. " +
                    "Publishing to the community library is always free.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${b.total}", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("buddies you can make", Modifier.padding(bottom = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val parts = buildList {
                if (b.freeLeft > 0) add(plural(b.freeLeft, "free buddy", "free buddies"))
                if (b.credits > 0) add(plural(b.credits, "credit", "credits"))
                b.subscription?.takeIf { it.active }?.let {
                    val per = wallet.catalog.product(it.productId)?.credits ?: 0
                    add("Creator plan: ${it.left} of $per left this month, ${if (it.autoRenew) "renews" else "ends"} ${day(it.paidThrough)}")
                }
            }
            Text(if (parts.isEmpty()) "Nothing left to spend. Pick a pack or the Creator plan below." else parts.joinToString(" · "))

            for (p in wallet.catalog.products) {
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                val isSub = p.kind == ProductKind.Subscription
                val active = isSub && b.subscription?.active == true && b.subscription.productId == p.id
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        val per = when {
                            isSub -> " / month"
                            p.credits > 1 -> " · ${formatPrice(Math.round(p.priceCents.toDouble() / p.credits).toInt())} each"
                            else -> ""
                        }
                        Text("${p.title}  ${formatPrice(p.priceCents)}$per", style = MaterialTheme.typography.titleSmall)
                        Text(p.blurb, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val enabled = !busy && provider.ready
                    when {
                        !active -> if (p.id == "pack5") Button(onClick = { buy(p) }, enabled = enabled) { Text("Buy") }
                        else OutlinedButton(onClick = { buy(p) }, enabled = enabled) { Text(if (isSub) "Subscribe" else "Buy") }
                        b.subscription!!.autoRenew -> OutlinedButton(onClick = { stopRenewal() }, enabled = enabled) { Text("Stop renewal") }
                        else -> Text("Ends ${day(b.subscription!!.paidThrough)}", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Text(
                "Each buddy includes up to ${wallet.catalog.maxReprocesses} free re-dos. If making it fails on our side, you get it back. " +
                    when {
                        provider == DevPaymentProvider -> "Test payments are on in this debug build: no money moves."
                        provider.ready -> "Payments by ${provider.name}."
                        else -> "Checkout isn't switched on yet."
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
