package ai.illyrobotic.screenbuddy.ui

import ai.illyrobotic.screenbuddy.billing.TestWallet
import ai.illyrobotic.screenbuddy.billing.WalletStore
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private fun day(ms: Long): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(ms))

private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

/**
 * How many buddies you can still make. The Android app only spends; it sells nothing and shows no prices, buy
 * buttons or links to buy elsewhere (see billing/WalletStore.kt for why).
 */
@Composable
fun BalanceCard(snackbar: SnackbarHostState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { WalletStore(context) }
    val wallet = remember { store.load() }
    val testing = remember { TestWallet.enabled(context) }
    var version by remember { mutableIntStateOf(0) }       // bumped after every change, so the card redraws
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); now = System.currentTimeMillis() } }

    val b = remember(version, now) { wallet.balance(now) }

    fun test(change: () -> String) {
        val message = change()
        store.save(wallet)
        now = System.currentTimeMillis()
        version++
        scope.launch { snackbar.showSnackbar(message) }
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Buddies from your own videos", style = MaterialTheme.typography.titleSmall)
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
            if (parts.isNotEmpty()) Text(parts.joinToString(" · "))
            Text(
                "Your first buddy is free. Each buddy includes up to ${wallet.catalog.maxReprocesses} free re-dos, and if making one " +
                    "fails on our side you get it back. Publishing to the community library is always free.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (testing) {
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                Text("Debug build: test the balance", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { test { TestWallet.grant(wallet, "pack5"); "Added 5 test credits." } }) { Text("+5 credits") }
                    OutlinedButton(onClick = { test { TestWallet.grant(wallet, "creator_monthly"); "Test Creator plan added." } }) { Text("+ plan") }
                    OutlinedButton(onClick = {
                        test {
                            val r = TestWallet.spend(wallet)
                            if (r.ok) "Used 1 (${r.source?.key})." else "Nothing left to use."
                        }
                    }) { Text("Use 1") }
                }
            }
        }
    }
}
