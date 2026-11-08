using System;
using System.Threading.Tasks;
using System.Windows;
using ScreenBuddy.Core.Billing;

namespace ScreenBuddy.App;

// Payment providers: the one place where money is taken. The rest of the app only sees a Receipt.
//
// CheckoutAsync must return a Receipt only after the payment is captured (status COMPLETED), throw
// PaymentException(cancelled: true) when the buyer backs out, and PaymentException for anything else. The wallet
// re-checks product, amount and currency against the catalog and ignores a receipt id it has already applied, so
// retrying is safe. Receipt fields are described in web/js/payments.js and billing/README.md.
//
// Until sign-in and the server exist, receipts are applied on this PC, so a determined user could fake one.
// Before real money: verify each order on the server (PayPal Orders API or webhooks) and keep the wallet there.

internal sealed class PaymentException(string message, bool cancelled = false) : Exception(message)
{
    public bool Cancelled { get; } = cancelled;
}

internal interface IPaymentProvider
{
    string Name { get; }
    /// <summary>False until checkout really takes payments; the store disables its buttons.</summary>
    bool Ready { get; }
    Task<Receipt> CheckoutAsync(Product product, Window owner);
    /// <summary>Turns off renewal of the Creator plan at the provider.</summary>
    Task CancelSubscriptionAsync(Window owner);
}

/// <summary>Connect your PayPal account here.</summary>
internal sealed class PayPalPaymentProvider : IPaymentProvider
{
    /// <summary>REST app client id (sandbox first).</summary>
    public const string ClientId = "";
    /// <summary>Billing plan id for the Creator plan, $2.99 / month.</summary>
    public const string CreatorPlanId = "";

    public string Name => "PayPal";
    public bool Ready => false;

    public Task<Receipt> CheckoutAsync(Product product, Window owner) =>
        // Wire PayPal here: one-off packs as an order for product.PriceCents in Catalog.Default.Currency, the Creator plan
        // as a subscription on CreatorPlanId. Return the Receipt described at the top of this file.
        throw new PaymentException($"PayPal checkout isn't connected yet ({product.Id}).");

    public Task CancelSubscriptionAsync(Window owner) => throw new PaymentException("PayPal isn't connected yet.");
}

/// <summary>Test payments for Debug builds: no money moves.</summary>
internal sealed class DevPaymentProvider : IPaymentProvider
{
    public string Name => "Test payments";
    public bool Ready => true;

    public Task<Receipt> CheckoutAsync(Product product, Window owner) => Task.FromResult(new Receipt(
        $"dev-{Guid.NewGuid():N}", product.Id, product.PriceCents, Catalog.Default.Currency, "COMPLETED", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));

    public Task CancelSubscriptionAsync(Window owner) => Task.CompletedTask;
}

internal static class Payments
{
    /// <summary>Test payments in Debug builds, PayPal in Release builds.</summary>
    public static IPaymentProvider Pick() =>
#if DEBUG
        new DevPaymentProvider();
#else
        new PayPalPaymentProvider();
#endif
}
