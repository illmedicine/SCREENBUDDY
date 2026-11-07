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
