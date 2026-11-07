using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ScreenBuddy.Core;

namespace ScreenBuddy.App;

/// <summary>
/// <c>ScreenBuddy.exe --selftest out.png</c>: loads every bundled buddy, renders its standing frame and a pose
/// off-screen over a grey backdrop (so transparency is visible), and writes one contact sheet. Touches no windows, the
/// tray or the registry. Exit code 0 means every buddy decoded and drew something.
/// </summary>
internal static class SelfTest
{
    public static int Run(string outputPng, string bundledRoot)
    {
        var library = new BuddyLibrary(bundledRoot, Path.Combine(Path.GetTempPath(), "screenbuddy-selftest-none"));
        var buddies = library.List();
        if (buddies.Count == 0) { Console.Error.WriteLine("FAIL: no buddies found in " + bundledRoot); return 1; }

        const double height = 260;
        var row = new StackPanel { Orientation = Orientation.Horizontal, Background = new SolidColorBrush(Color.FromRgb(0x55, 0x60, 0x70)) };
        var failures = 0;

        foreach (var buddy in buddies)
        {
            var bank = new SpriteBank(buddy);
            bank.LoadAll();
            var wanted = new[] { buddy.Manifest.StandClip }.Concat(buddy.Manifest.Poses).Distinct().ToList();
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (wanted.Any(m => !bank.Ready(m)) && DateTime.UtcNow < deadline) Thread.Sleep(20);
            var missing = wanted.Where(m => !bank.Ready(m)).ToList();
            if (missing.Count > 0)
            {
                Console.Error.WriteLine($"FAIL: {buddy.Id}: did not load: {string.Join(", ", missing)}");
                failures++;
                continue;
            }

            long now = 1000;
            var width = BuddyLayout.WindowWidth(height, buddy.Manifest);
            foreach (var pose in new[] { false, true })
            {
                var el = new BuddyElement(bank) { Clock = () => now, Width = width, Height = height };
                if (pose)
                {
                    if (!el.Pose()) { Console.Error.WriteLine($"FAIL: {buddy.Id}: could not start a pose"); failures++; }
                    now += 400;                                 // part-way through the pose
                    el.Tick();
                }
                row.Children.Add(el);
                Console.WriteLine($"{buddy.Id}: {(pose ? "pose" : "stand")} -> {el.Picked.Move} frame {el.Picked.Frame}");
            }
        }

        row.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        row.Arrange(new Rect(row.DesiredSize));
        row.UpdateLayout();
        var w = (int)Math.Ceiling(row.DesiredSize.Width);
        var h = (int)Math.Ceiling(row.DesiredSize.Height);
        var rtb = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(row);

        // Every buddy should have put non-backdrop pixels on the sheet.
        var pixels = new byte[w * h * 4];
        rtb.CopyPixels(pixels, w * 4, 0);
        var backdrop = (B: (byte)0x70, G: (byte)0x60, R: (byte)0x55);
        var drawn = 0;
        for (var i = 0; i < pixels.Length; i += 4)
            if (pixels[i] != backdrop.B || pixels[i + 1] != backdrop.G || pixels[i + 2] != backdrop.R) drawn++;
        Console.WriteLine($"sheet {w}x{h}, {drawn} pixels differ from the backdrop");
        if (drawn < w * h / 20) { Console.Error.WriteLine("FAIL: almost nothing was drawn"); failures++; }

        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(rtb));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPng))!);
        using (var f = File.Create(outputPng)) encoder.Save(f);
        Console.WriteLine(failures == 0 ? $"OK: wrote {outputPng}" : $"{failures} failure(s); wrote {outputPng}");
        return failures == 0 ? 0 : 1;
    }
}

/// <summary>
/// <c>ScreenBuddy.exe --motiontest</c>: checks the typing and steady movement end to end with a real keyboard hook.
/// It presses the F24 key (which no program uses) twice and watches the buddy start and stop. The microphone is not
/// touched. Exit code 0 means everything behaved.
/// </summary>
internal static class MotionSelfTest
{
    public static int Run(string bundledRoot)
    {
        var buddy = new BuddyLibrary(bundledRoot, Path.Combine(Path.GetTempPath(), "screenbuddy-selftest-none")).List().FirstOrDefault();
        if (buddy is null) { Console.Error.WriteLine("FAIL: no buddies"); return 1; }
        var bank = new SpriteBank(buddy);
        bank.LoadAll();
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!bank.Ready(buddy.Manifest.Scroll) && DateTime.UtcNow < deadline) Thread.Sleep(20);

        var failures = 0;
        void Check(bool ok, string what)
        {
            Console.WriteLine((ok ? "ok   " : "FAIL ") + what);
            if (!ok) failures++;
        }

        // Counts every key press on the machine, so a check that needs a quiet keyboard can tell when someone was typing.
        var presses = 0;
        using var watch = new KeyboardActivity();
        watch.KeyDown += () => presses++;
        watch.Start();

        // A "nothing should happen" check only means something if nobody touched the keyboard meanwhile.
        void CheckQuiet(Func<bool> ok, string what, int waitMs)
        {
            var before = presses;
            Pump(waitMs);
            if (presses != before) Console.WriteLine("skip " + what + " (keys were pressed meanwhile)");
            else Check(ok(), what);
        }

        // 1. The raw hook.
        var start = presses;
        Check(Win32.TapKey(0x87), "sent a synthetic F24 key");
        Pump(300);
        Check(presses > start, $"keyboard hook saw it ({presses - start} key event(s))");

        // 2. Typing mode.
        var el = new BuddyElement(bank);
        using (var typing = new MotionDriver(el, MotionMode.Typing))
        {
            typing.Problem += m => { Console.WriteLine("problem: " + m); failures++; };
            typing.Start();
            CheckQuiet(() => !el.Animating, "typing mode: still before any key", 300);
            Win32.TapKey(0x87);
            Pump(250);
            Check(el.Animating, "typing mode: moves after a key press");
            CheckQuiet(() => !el.Animating, "typing mode: stops again after typing stops", 2000);
        }

        // 3. Steady mode.
        var el2 = new BuddyElement(bank);
        using (var steady = new MotionDriver(el2, MotionMode.Steady))
        {
            steady.Start();
            Pump(300);
            Check(el2.Animating, "steady mode: moving without any input");
            el2.Paused = true;
            Pump(800);
            Check(!el2.Animating, "steady mode: holds still while paused");
        }

        Console.WriteLine(failures == 0 ? "OK" : $"{failures} failure(s)");
        return failures == 0 ? 0 : 1;
    }

    /// <summary>Lets the UI thread run timers and hook callbacks for a while.</summary>
    private static void Pump(int ms)
    {
        var frame = new System.Windows.Threading.DispatcherFrame();
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(ms) };
        timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; };
        timer.Start();
        System.Windows.Threading.Dispatcher.PushFrame(frame);
    }
}
