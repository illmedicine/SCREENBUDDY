using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using ScreenBuddy.Core.Billing;

namespace ScreenBuddy.App;

/// <summary>"Make your own buddies": what's left to spend and the three ways to buy more. Opened from the tray menu.</summary>
internal sealed class StoreWindow : Window
{
    private static readonly Brush Bg = new SolidColorBrush(Color.FromRgb(0x0B, 0x1F, 0x3A));
    private static readonly Brush Card = new SolidColorBrush(Color.FromRgb(0x13, 0x2B, 0x4F));
    private static readonly Brush Line = new SolidColorBrush(Color.FromRgb(0x2C, 0x45, 0x6E));
    private static readonly Brush Teal = new SolidColorBrush(Color.FromRgb(0x14, 0xB8, 0xA6));
    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(0xA9, 0xB6, 0xDC));
    private static readonly Brush Error = new SolidColorBrush(Color.FromRgb(0xFF, 0x9A, 0xA8));

    private readonly WalletStore _store;
    private readonly Wallet _wallet;
    private readonly IPaymentProvider _provider = Payments.Pick();
    private readonly StackPanel _root = new() { Margin = new Thickness(20) };
    private readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromMinutes(1) };
    private string _message = "";
    private bool _messageIsError;
    private bool _busy;

    public StoreWindow(WalletStore store)
    {
        _store = store;
        _wallet = store.Load();
        Title = "Screen Buddy: make your own buddies";
        Width = 460;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.CanMinimize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = Bg;
        Foreground = Brushes.White;
        FontFamily = new FontFamily("Segoe UI");
        FontSize = 14;
        Content = new ScrollViewer { Content = _root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        _clock.Tick += (_, _) => Render();       // keeps "left this month" honest across a renewal
        _clock.Start();
        Closed += (_, _) => _clock.Stop();
        Render();
    }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static string Price(int cents) => (cents / 100m).ToString("C", CultureInfo.GetCultureInfo("en-US"));
    private static string Day(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("MMM d, yyyy", CultureInfo.CurrentCulture);
    private static string Plural(int n, string one, string many) => $"{n} {(n == 1 ? one : many)}";

    private static TextBlock Text(string text, double size = 14, Brush? color = null, FontWeight? weight = null) => new()
    {
        Text = text, FontSize = size, Foreground = color ?? Brushes.White, FontWeight = weight ?? FontWeights.Normal,
        TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 4),
    };

    private Button ActionButton(string label, Action onClick, bool primary = false)
    {
        var b = new Button
        {
            Content = label, MinWidth = 104, Padding = new Thickness(14, 6, 14, 6), VerticalAlignment = VerticalAlignment.Center,
            Background = primary ? Teal : Card, Foreground = primary ? Bg : Brushes.White, BorderBrush = primary ? Teal : Line,
            FontWeight = FontWeights.SemiBold, IsEnabled = !_busy && _provider.Ready,
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    private void Render()
    {
        var b = _wallet.GetBalance(Now);
        _root.Children.Clear();
        _root.Children.Add(Text("Make buddies from your own videos", 20, weight: FontWeights.SemiBold));
        _root.Children.Add(Text("The app is free and your first buddy is on us. After that, pay per buddy or join the Creator plan. " +
                                "Publishing to the community library is always free.", 13, Muted));

        var total = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
        total.Children.Add(Text(b.Total.ToString(CultureInfo.CurrentCulture), 36, Teal, FontWeights.Bold));
        total.Children.Add(new TextBlock { Text = "  buddies you can make", Foreground = Muted, VerticalAlignment = VerticalAlignment.Center });
        _root.Children.Add(total);

        var parts = new System.Collections.Generic.List<string>();
        if (b.FreeLeft > 0) parts.Add(Plural(b.FreeLeft, "free buddy", "free buddies"));
        if (b.Credits > 0) parts.Add(Plural(b.Credits, "credit", "credits"));
        if (b.Subscription is { Active: true } s)
            parts.Add($"Creator plan: {s.Left} of {_wallet.Catalog.Find(s.ProductId)?.Credits ?? 0} left this month, {(s.AutoRenew ? "renews" : "ends")} {Day(s.PaidThrough)}");
        _root.Children.Add(Text(parts.Count > 0 ? string.Join(" · ", parts) : "Nothing left to spend. Pick a pack or the Creator plan below."));

        foreach (var p in _wallet.Catalog.Products)
        {
            var isSub = p.Kind == ProductKind.Subscription;
            var active = isSub && b.Subscription is { Active: true } sub && sub.ProductId == p.Id;
            var per = isSub ? " / month" : p.Credits > 1 ? $"  ·  {Price((int)Math.Round((double)p.PriceCents / p.Credits))} each" : "";

            var text = new StackPanel();
            text.Children.Add(Text($"{p.Title}   {Price(p.PriceCents)}{per}", 15, weight: FontWeights.SemiBold));
            text.Children.Add(Text(p.Blurb, 12.5, Muted));

            UIElement action = !active
                ? ActionButton(isSub ? "Subscribe" : "Buy", () => Buy(p), primary: p.Id == "pack5")
                : b.Subscription!.AutoRenew
                    ? ActionButton("Stop renewal", StopRenewal)
                    : Text($"Ends {Day(b.Subscription.PaidThrough)}", 12.5, Muted);

            var row = new DockPanel { LastChildFill = true };
            DockPanel.SetDock(action, Dock.Right);
            row.Children.Add(action);
            row.Children.Add(text);
            _root.Children.Add(new Border
            {
                Background = Card, BorderBrush = Line, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12),
                Padding = new Thickness(14, 10, 14, 10), Margin = new Thickness(0, 10, 0, 0), Child = row,
            });
        }

        if (_message.Length > 0) _root.Children.Add(Text(_message, 13, _messageIsError ? Error : Teal).Also(t => t.Margin = new Thickness(0, 12, 0, 0)));
        var note = _provider is DevPaymentProvider ? "Test payments are on in this Debug build: no money moves."
            : _provider.Ready ? $"Payments by {_provider.Name}." : "Checkout isn't switched on yet.";
        _root.Children.Add(Text($"Each buddy includes up to {_wallet.Catalog.MaxReprocesses} free re-dos. If making it fails on our side, you get it back. {note}", 12, Muted)
            .Also(t => t.Margin = new Thickness(0, 12, 0, 0)));
    }

    private void Say(string message, bool isError = false) { _message = message; _messageIsError = isError; }

    private async void Buy(Product p)
    {
        if (_busy) return;
        _busy = true;
        Say("");
        Render();
        try
        {
            var r = _wallet.ApplyPayment(await _provider.CheckoutAsync(p, this));
            if (!r.Ok) Say(r.Code switch
            {
                "unknown_product" => "That item isn't for sale any more.",
                "not_completed" => "The payment didn't go through, so nothing was added.",
                _ => "The payment couldn't be confirmed. Nothing was added; contact support if you were charged.",
            }, true);
            else
            {
                _store.Save(_wallet);
                Say(r.Code == "already_applied" ? "That payment was already added."
                    : p.Kind == ProductKind.Subscription ? $"You're on the Creator plan: {p.Credits} buddies a month."
                    : $"Added {Plural(p.Credits, "buddy", "buddies")}.");
            }
        }
        catch (PaymentException e) { if (!e.Cancelled) Say(e.Message, true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Say("Paid, but the balance couldn't be saved on this PC. Contact support.", true); }
        finally
        {
            _busy = false;
            Render();
        }
    }

    private async void StopRenewal()
    {
        if (_busy) return;
        _busy = true;
        Render();
        try
        {
            await _provider.CancelSubscriptionAsync(this);
            _wallet.CancelSubscription();
            _store.Save(_wallet);
            Say($"Renewal is off. Your plan keeps working until {Day(_wallet.PaidThrough() ?? Now)}.");
        }
        catch (PaymentException e) { Say(e.Message, true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Say("Couldn't save that change on this PC. Try again.", true); }
        finally
        {
            _busy = false;
            Render();
        }
    }
}

internal static class UiExtensions
{
    public static T Also<T>(this T value, Action<T> change) { change(value); return value; }
}
