using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using ScreenBuddy.Core;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

/// <summary>
/// Keeps a release install current from GitHub Releases. Checks 30 seconds after start and every 6 hours (when
/// "Update automatically" is on), or when the user picks "Check for updates". A newer release is downloaded to
/// %LOCALAPPDATA%\ScreenBuddy\updates, its SHA-256 checked against update.json, unpacked, and then the new copy is
/// started with <c>--apply-update</c>: it waits for this process to exit, swaps the install folder over
/// (<see cref="InstallSwapper"/>) and starts the updated app. Settings and imported buddies are outside the install
/// folder, so they carry over untouched.
/// </summary>
internal sealed class Updater : IDisposable
{
    public const string ApplyArg = "--apply-update";
    public const string UpdatedArg = "--updated";
    public const string FailedArg = "--update-failed";

    private static readonly TimeSpan FirstCheck = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan CheckEvery = TimeSpan.FromHours(6);

    private readonly string _installDir;
    private readonly string _updatesDir;
    private readonly ReleaseChannel? _channel;
    private readonly UpdatePreferencesStore _store;
    private readonly WinForms.NotifyIcon _tray;
    private readonly DispatcherTimer _timer;
    private readonly HttpClient _http;
    private UpdatePreferences _prefs;
    private DateTime _lastCheck = DateTime.MinValue;
    private bool _busy;

    public static AppVersion Current { get; } = ReadCurrentVersion();

    public Updater(string installDir, string dataRoot, WinForms.NotifyIcon tray)
    {
        _installDir = installDir;
        _updatesDir = Path.Combine(dataRoot, "updates");
        _channel = ReleaseChannel.Load(installDir);
        _store = new UpdatePreferencesStore(Path.Combine(dataRoot, "updates.json"));
        _prefs = _store.Load();
        _tray = tray;
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ScreenBuddy-Updater", Current.ToString()));
        _timer = new DispatcherTimer { Interval = FirstCheck };
        _timer.Tick += async (_, _) =>
        {
            _timer.Interval = Tick;
            if (_prefs.AutoUpdate && DateTime.UtcNow - _lastCheck >= CheckEvery) await CheckAsync(userAsked: false);
        };
    }

    /// <summary>Starts the timer. <paramref name="launchArg"/> is the app's first argument, to report a finished update.</summary>
    public void Start(string? launchArg)
    {
        if (launchArg == UpdatedArg)
            _tray.ShowBalloonTip(4000, "Screen Buddy", $"Updated to version {Current}.", WinForms.ToolTipIcon.Info);
        else if (launchArg == FailedArg)
            _tray.ShowBalloonTip(6000, "Screen Buddy", "The update couldn't be installed, so this version is still running. Details are in error.log.", WinForms.ToolTipIcon.Warning);
        InstallSwapper.CleanUp(_installDir);
        if (_channel is null) return;                       // a dev build: no shortcuts, no updates

        Shortcuts.Ensure(firstRun: !_prefs.ShortcutsCreated);
        if (!_prefs.ShortcutsCreated)
        {
            _prefs = _prefs with { ShortcutsCreated = true };
            _store.Save(_prefs);
        }
        _timer.Start();
    }

    public void AddMenuItems(WinForms.ToolStripItemCollection items)
    {
        var check = new WinForms.ToolStripMenuItem(_busy ? "Checking for updates..." : "Check for updates")
        {
            Enabled = !_busy,
            ToolTipText = $"Version {Current}",
        };
        check.Click += async (_, _) => await CheckAsync(userAsked: true);
        items.Add(check);

        var auto = new WinForms.ToolStripMenuItem("Update automatically") { Checked = _prefs.AutoUpdate, Enabled = _channel is not null };
        auto.Click += (_, _) =>
        {
            _prefs = _prefs with { AutoUpdate = !_prefs.AutoUpdate };
            _store.Save(_prefs);
        };
        items.Add(auto);
    }

    public async Task CheckAsync(bool userAsked)
    {
        if (_channel is null)
        {
            if (userAsked) Info($"This is Screen Buddy {Current}. This copy wasn't installed from a release, so it doesn't update itself.\n\nDownload the latest release from GitHub to get automatic updates.");
            return;
        }
        if (_busy) return;
        _busy = true;
        _lastCheck = DateTime.UtcNow;
        try
        {
            CleanStaged();
            var list = await GetStringAsync(_channel.ReleasesApi, api: true);
            var latest = GitHubReleases.FindLatest(list, _channel);
            if (latest is null || latest.Version <= Current)
            {
                if (userAsked) Balloon($"You have the latest version ({Current}).");
                return;
            }

            var manifest = UpdateManifest.Parse(await GetStringAsync(latest.ManifestUrl, api: false));
            if (!manifest.Version.Equals(latest.Version))
                throw new InvalidUpdateException($"update.json says {manifest.Version} but the release is {latest.Version}");

            if (userAsked) Balloon($"Downloading Screen Buddy {manifest.Version}...");
            var staged = await DownloadAndStageAsync(manifest);

            Balloon($"Updating to Screen Buddy {manifest.Version}. Your buddy will be back in a moment.");
            await Task.Delay(1500);
            Launch(staged);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or UnauthorizedAccessException
                                     or InvalidUpdateException or InvalidDataException or System.ComponentModel.Win32Exception)
        {
            Program.Log(e);
            if (userAsked) Info($"Couldn't check for updates.\n\n{e.Message}", warning: true);
        }
        finally
        {
            _busy = false;
        }
    }

    private async Task<string> GetStringAsync(Uri uri, bool api)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        if (api) req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsStringAsync();
    }

    /// <summary>Downloads the release zip, checks its size and hash, and unpacks it. Returns the folder with the new app.</summary>
    private async Task<string> DownloadAndStageAsync(UpdateManifest m)
    {
        Directory.CreateDirectory(_updatesDir);
        var part = Path.Combine(_updatesDir, $"ScreenBuddy-{m.Version}.zip.part");
        try
        {
            using (var resp = await _http.GetAsync(m.Url, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                if (resp.Content.Headers.ContentLength is long len && len != m.Size)
                    throw new InvalidUpdateException($"The download is {len} bytes, update.json says {m.Size}");
                await using var input = await resp.Content.ReadAsStreamAsync();
                await using var output = File.Create(part);
                var buffer = new byte[81920];
                long total = 0;
                int n;
                while ((n = await input.ReadAsync(buffer)) > 0)
                {
                    total += n;
                    if (total > m.Size) throw new InvalidUpdateException("The download is larger than update.json says");
                    await output.WriteAsync(buffer.AsMemory(0, n));
                }
                if (total != m.Size) throw new InvalidUpdateException("The download was cut short");
            }

            string hash;
            using (var f = File.OpenRead(part)) hash = UpdateManifest.Sha256Hex(f);
            if (hash != m.Sha256) throw new InvalidUpdateException("The download doesn't match its SHA-256 checksum");

            var staged = Path.Combine(_updatesDir, "staged", m.Version.ToString());
            if (Directory.Exists(staged)) Directory.Delete(staged, recursive: true);
            await Task.Run(() => ZipFile.ExtractToDirectory(part, staged));    // refuses entries that escape the folder
            if (!File.Exists(Path.Combine(staged, InstallSwapper.ExeName)))
                throw new InvalidUpdateException($"The release zip has no {InstallSwapper.ExeName} at its top level");
            return staged;
        }
        finally
        {
            try { File.Delete(part); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>Starts the new copy in apply mode and exits, so it can replace this one.</summary>
    private void Launch(string staged)
    {
        var psi = new ProcessStartInfo(Path.Combine(staged, InstallSwapper.ExeName)) { UseShellExecute = false, WorkingDirectory = staged };
        psi.ArgumentList.Add(ApplyArg);
        psi.ArgumentList.Add(_installDir);
        psi.ArgumentList.Add(Environment.ProcessId.ToString());
        using (Process.Start(psi)) { }
        System.Windows.Application.Current.Shutdown();
    }

    /// <summary>Removes unpacked releases from earlier updates (best effort; one still running is skipped).</summary>
    private void CleanStaged()
    {
        var dir = Path.Combine(_updatesDir, "staged");
        if (!Directory.Exists(dir)) return;
        foreach (var d in Directory.GetDirectories(dir))
        {
            try { Directory.Delete(d, recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private void Balloon(string text) => _tray.ShowBalloonTip(4000, "Screen Buddy", text, WinForms.ToolTipIcon.Info);

    private static void Info(string text, bool warning = false) =>
        WinForms.MessageBox.Show(text, "Screen Buddy", WinForms.MessageBoxButtons.OK,
            warning ? WinForms.MessageBoxIcon.Warning : WinForms.MessageBoxIcon.Information);

    private static AppVersion ReadCurrentVersion()
    {
        var asm = typeof(Updater).Assembly;
        var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (AppVersion.TryParse(info, out var v)) return v;
        return AppVersion.Parse(asm.GetName().Version?.ToString() ?? "0.0.0");
    }

    public void Dispose()
    {
        _timer.Stop();
        _http.Dispose();
    }

    // ---- apply mode (runs from the staged copy) -----------------------------------------------------

    /// <summary>
    /// <c>ScreenBuddy.exe --apply-update &lt;installDir&gt; &lt;pid&gt;</c>, run from the unpacked new version. Waits for the old
    /// app to exit, copies this version over the install folder and starts it. Keep this argument contract stable:
    /// an older app launches the newer one with it.
    /// </summary>
    public static int Apply(string[] args)
    {
        if (args.Length < 3 || !int.TryParse(args[2], out var pid)) return 2;
        var target = args[1];
        try
        {
            using var old = Process.GetProcessById(pid);
            if (!old.WaitForExit(60_000)) return 3;        // it didn't close: leave it alone rather than fight over the mutex
        }
        catch (ArgumentException) { }                       // already gone
        catch (InvalidOperationException) { }

        var ok = false;
        for (var attempt = 0; attempt < 3 && !ok; attempt++)
        {
            try
            {
                InstallSwapper.Apply(AppContext.BaseDirectory, target);
                ok = true;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidUpdateException)
            {
                Program.Log(e);
                if (e is InvalidUpdateException) break;
                Thread.Sleep(1000);                         // antivirus or the indexer may hold a file for a moment
            }
        }

        try
        {
            var psi = new ProcessStartInfo(Path.Combine(target, InstallSwapper.ExeName)) { UseShellExecute = false, WorkingDirectory = target };
            psi.ArgumentList.Add(ok ? UpdatedArg : FailedArg);
            using (Process.Start(psi)) { }
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException)
        {
            Program.Log(e);
        }
        return ok ? 0 : 1;
    }
}
