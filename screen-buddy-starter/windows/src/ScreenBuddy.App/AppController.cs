using System;
using System.IO;
using System.Linq;
using Microsoft.Win32;
using ScreenBuddy.Core;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

/// <summary>Ties the tray icon, the library, the settings and the floating buddy together.</summary>
internal sealed class AppController : IDisposable
{
    private readonly BuddyLibrary _lib;
    private readonly SettingsStore _store;
    private readonly WinForms.NotifyIcon _tray;
    private readonly WinForms.ContextMenuStrip _menu = new();
    private readonly System.Drawing.Icon _icon;
    private AppSettings _s;
    private SpriteBank? _bank;
    private OverlayWindow? _win;
    private readonly ScreenBuddy.Core.Billing.WalletStore _wallet;
    private StoreWindow? _storeWin;

    public AppController(string bundledRoot, string dataRoot)
    {
        _lib = new BuddyLibrary(bundledRoot, Path.Combine(dataRoot, "buddies"));
        _store = new SettingsStore(Path.Combine(dataRoot, "settings.json"));
        _wallet = new ScreenBuddy.Core.Billing.WalletStore(Path.Combine(dataRoot, "wallet.json"));
        _s = _store.Load();
        _icon = TrayIcon.Create();
        _menu.Opening += (_, _) => BuildMenu();
        _tray = new WinForms.NotifyIcon { Icon = _icon, Text = "Screen Buddy", Visible = true, ContextMenuStrip = _menu };
        _tray.MouseDoubleClick += (_, e) => { if (e.Button == WinForms.MouseButtons.Left) SetVisible(!_s.Visible); };
    }

    public void Start()
    {
        if (_s.Visible) ShowBuddy();
    }

    // ---- state -------------------------------------------------------------------------------------

    private void Update(Func<AppSettings, AppSettings> change)
    {
        _s = change(_s).Clamped();
        _store.Save(_s);
        _win?.Apply(_s);
    }

    private void ShowBuddy()
    {
        var buddy = _lib.Find(_s.BuddyId);
        if (buddy is null)
        {
            _tray.ShowBalloonTip(4000, "Screen Buddy", "No buddies found. Use \"Add a buddy\" to import one.", WinForms.ToolTipIcon.Warning);
            return;
        }
        if (_win is not null && _bank?.Buddy.Id == buddy.Id) { _win.Show(); return; }
        CloseBuddy();
        _bank = new SpriteBank(buddy);
        _win = new OverlayWindow(_bank, _s with { BuddyId = buddy.Id });
        _win.Moved += (x, y) => Update(s => s with { X = x, Y = y });
        _win.MenuRequested += ShowMenuAtCursor;
        _win.MotionProblem += OnMotionProblem;
        _win.Show();
        Update(s => s with { BuddyId = buddy.Id, Visible = true });
    }

    private void CloseBuddy()
    {
        _win?.Close();
        _win = null;
        _bank = null;
    }

    private void SetVisible(bool visible)
    {
        if (visible) ShowBuddy();
        else { CloseBuddy(); Update(s => s with { Visible = false }); }
    }

    private void Select(string id)
    {
        CloseBuddy();
        Update(s => s with { BuddyId = id, Visible = true });
        ShowBuddy();
    }

    private void OnMotionProblem(MotionMode mode, string message)
    {
        if (_s.Motion != mode) return;
        _tray.ShowBalloonTip(6000, "Screen Buddy", message, WinForms.ToolTipIcon.Warning);
        Update(s => s with { Motion = MotionMode.Touch });
    }

    private void ChooseMotion(MotionMode mode)
    {
        Update(s => s with { Motion = mode });
        var note = mode switch
        {
            MotionMode.Typing => "Moving while you type. Screen Buddy only notices that a key was pressed; it never reads which keys, and nothing is saved or sent.",
            MotionMode.Sound => "Moving when the microphone hears sound. Screen Buddy only measures loudness; nothing is recorded, saved or sent.",
            _ => null,
        };
        if (note is not null && _win is not null) _tray.ShowBalloonTip(6000, "Screen Buddy", note, WinForms.ToolTipIcon.Info);
    }

    private void ShowMenuAtCursor() => _menu.Show(WinForms.Cursor.Position);

    // ---- menu --------------------------------------------------------------------------------------

    private void BuildMenu()
    {
        var items = _menu.Items;
        items.Clear();
        var current = _lib.Find(_s.BuddyId);

        WinForms.ToolStripMenuItem Item(string text, Action onClick, bool isChecked = false, bool enabled = true)
        {
            var it = new WinForms.ToolStripMenuItem(text) { Checked = isChecked, Enabled = enabled };
            it.Click += (_, _) => onClick();
            return it;
        }

        items.Add(Item("Show buddy", () => SetVisible(!_s.Visible), _s.Visible));
        items.Add(Item("Strike a pose", () => _win?.Element.Pose(), enabled: _win is not null && !_s.Paused));
        items.Add(Item(_s.Paused ? "Resume" : "Pause", () => Update(s => s with { Paused = !s.Paused }), enabled: _win is not null));
        items.Add(new WinForms.ToolStripSeparator());

        var switchMenu = new WinForms.ToolStripMenuItem("Switch buddy");
        foreach (var b in _lib.List())
            switchMenu.DropDownItems.Add(Item(b.Manifest.Name, () => Select(b.Id), b.Id == current?.Id));
        items.Add(switchMenu);

        var motion = new WinForms.ToolStripMenuItem("Movement");
        foreach (var (label, mode) in new[]
                 {
                     ("Only when I touch it", MotionMode.Touch),
                     ("Steady", MotionMode.Steady),
                     ("When I type", MotionMode.Typing),
                     ("When there's sound (microphone)", MotionMode.Sound),
                 })
            motion.DropDownItems.Add(Item(label, () => ChooseMotion(mode), _s.Motion == mode));
        items.Add(motion);

        var size = new WinForms.ToolStripMenuItem("Size");
        foreach (var (label, h) in new[] { ("Small", 180.0), ("Medium", 260.0), ("Large", 360.0), ("Extra large", 480.0) })
            size.DropDownItems.Add(Item(label, () => Update(s => s with { Height = h }), Math.Abs(_s.Height - h) < 1));
        items.Add(size);

        var see = new WinForms.ToolStripMenuItem("Transparency");
        foreach (var pct in new[] { 100, 80, 60, 40 })
            see.DropDownItems.Add(Item(pct == 100 ? "Solid" : $"{pct}% visible", () => Update(s => s with { Opacity = pct }), _s.Opacity == pct));
        items.Add(see);

        items.Add(Item("Stand on the bottom edge", () => Update(s => s with { StayOnBottom = !s.StayOnBottom }), _s.StayOnBottom));
        items.Add(new WinForms.ToolStripSeparator());
        items.Add(Item("Make your own buddies...", OpenStore));
        items.Add(Item("Add a buddy (.zip)...", ImportBuddy));
        if (current is { Bundled: false })
            items.Add(Item($"Remove {current.Manifest.Name}", () => RemoveBuddy(current)));
        items.Add(Item("Start with Windows", () => StartupRegistration.Set(!StartupRegistration.IsEnabled), StartupRegistration.IsEnabled));
        items.Add(new WinForms.ToolStripSeparator());
        items.Add(Item("Exit", () => System.Windows.Application.Current.Shutdown()));
    }

    /// <summary>The pricing window. Only one at a time: a second click brings the open one forward.</summary>
    private void OpenStore()
    {
        if (_storeWin is not null) { _storeWin.Activate(); return; }
        _storeWin = new StoreWindow(_wallet);
        _storeWin.Closed += (_, _) => _storeWin = null;
        _storeWin.Show();
        _storeWin.Activate();
    }

    private void ImportBuddy()
    {
        using var dialog = new WinForms.OpenFileDialog { Title = "Add a buddy", Filter = "Buddy packages (*.zip)|*.zip", CheckFileExists = true };
        if (dialog.ShowDialog() != WinForms.DialogResult.OK) return;
        try
        {
            if (new FileInfo(dialog.FileName).Length > BuddyLibrary.MaxTotalBytes) throw new InvalidBuddyException("That file is too large.");
            using var file = File.OpenRead(dialog.FileName);
            var buddy = _lib.ImportZip(file);
            Select(buddy.Id);
        }
        catch (Exception e) when (e is InvalidBuddyException or IOException or UnauthorizedAccessException)
        {
            WinForms.MessageBox.Show($"Couldn't add that buddy.\n\n{e.Message}", "Screen Buddy", WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Warning);
        }
    }

    private void RemoveBuddy(Buddy buddy)
    {
        CloseBuddy();
        _lib.Delete(buddy);
        Update(s => s with { BuddyId = null });
        if (_s.Visible) ShowBuddy();
    }

    public void Dispose()
    {
        _tray.Visible = false;
        _tray.Dispose();
        _menu.Dispose();
        _icon.Dispose();
        _storeWin?.Close();
        CloseBuddy();
    }
}

/// <summary>"Start with Windows": a per-user Run entry. Nothing system-wide, and no admin rights needed.</summary>
internal static class StartupRegistration
{
    private const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "ScreenBuddy";

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(KeyPath);
            return key?.GetValue(ValueName) is string;
        }
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        if (key is null) return;
        if (enabled && Environment.ProcessPath is { } exe) key.SetValue(ValueName, $"\"{exe}\"");
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
