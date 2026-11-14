using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using ScreenBuddy.Core;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

internal static class Program
{
    private static string BundledRoot => Path.Combine(AppContext.BaseDirectory, "buddies");

    private static string DataRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenBuddy");

    /// <summary>
    /// No arguments: the tray app with the floating buddy. <c>/s</c>: screensaver. <c>/p</c>: the tiny preview in the
    /// Windows screensaver dialog (we don't draw one). <c>/c</c> or none from a .scr: settings. <c>--selftest f.png</c>.
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        var first = args.FirstOrDefault()?.ToLowerInvariant() ?? "";
        if (first == Updater.ApplyArg)
            return Updater.Apply(args);        // a freshly downloaded copy replacing the installed one
        if (first == "--selftest")
            return SelfTest.Run(args.Length > 1 ? args[1] : "selftest.png", BundledRoot);

        if (first == "--motiontest")
            return MotionSelfTest.Run(BundledRoot);

        if (first.StartsWith("/p") || first.StartsWith("-p")) return 0;
        if (first.StartsWith("/c") || first.StartsWith("-c") || (IsScreensaverFile && first.Length == 0))
        {
            WinForms.MessageBox.Show(
                "Screen Buddy's screensaver shows your current buddy walking across every screen.\n\n" +
                "Pick the buddy, size and transparency from the Screen Buddy tray icon.",
                "Screen Buddy screensaver", WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Information);
            return 0;
        }

        var screensaver = first.StartsWith("/s") || first.StartsWith("-s");
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.DispatcherUnhandledException += (_, e) =>
        {
            Log(e.Exception);
            e.Handled = true;                  // a desktop pet should not crash your session; the log has the details
        };

        if (screensaver) return RunScreensaver(app);

        using var mutex = new Mutex(true, "ScreenBuddy.Overlay." + Environment.UserName, out var first_instance);
        if (!first_instance)
        {
            // Already running (started again from the shortcut, say): ask that copy to show its buddy.
            if (EventWaitHandle.TryOpenExisting(RevealEventName, out var reveal)) using (reveal) reveal.Set();
            return 0;
        }
        using var revealSignal = new EventWaitHandle(false, EventResetMode.AutoReset, RevealEventName);
        using var controller = new AppController(BundledRoot, DataRoot);
        var wait = ThreadPool.RegisterWaitForSingleObject(revealSignal,
            (_, _) => app.Dispatcher.BeginInvoke(controller.Reveal), null, Timeout.Infinite, executeOnlyOnce: false);
        controller.Start(first);
        app.Run();
        wait.Unregister(null);
        return 0;
    }

    private static string RevealEventName => "ScreenBuddy.Reveal." + Environment.UserName;

    private static bool IsScreensaverFile =>
        Path.GetExtension(Environment.ProcessPath ?? "").Equals(".scr", StringComparison.OrdinalIgnoreCase);

    private static int RunScreensaver(Application app)
    {
        var library = new BuddyLibrary(BundledRoot, Path.Combine(DataRoot, "buddies")) { Hidden = HiddenList.Load(DataRoot) };
        var settings = new SettingsStore(Path.Combine(DataRoot, "settings.json")).Load();
        var buddy = library.Find(settings.BuddyId);
        var bank = buddy is null ? null : new SpriteBank(buddy);

        foreach (var screen in WinForms.Screen.AllScreens)
            new ScreensaverWindow(screen, screen.Primary ? bank : null).Show();    // other screens just stay black
        return app.Run();
    }

    internal static void Log(Exception e)
    {
        try
        {
            Directory.CreateDirectory(DataRoot);
            File.AppendAllText(Path.Combine(DataRoot, "error.log"), $"{DateTime.Now:O}\n{e}\n\n");
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
