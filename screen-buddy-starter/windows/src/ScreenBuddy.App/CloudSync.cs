using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using ScreenBuddy.Core;

namespace ScreenBuddy.App;

/// <summary>
/// Installs shared buddies added on the website after this release (see <see cref="CloudCatalog"/>): shortly after
/// start, then every 6 hours. Remembers which version of each it installed (cloud.json), so each zip downloads once.
/// Works offline too: a failed check is simply tried again next time.
/// </summary>
public sealed class CloudSync(BuddyLibrary lib, string dataRoot) : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(2) };
    private readonly string _stateFile = Path.Combine(dataRoot, "cloud.json");
    private System.Threading.Timer? _timer;

    /// <summary>Raised on a thread-pool thread when the admin's hidden list changed.</summary>
    public event Action? HiddenChanged;

    public void Start() => _timer = new System.Threading.Timer(_ => _ = SyncAsync(), null, TimeSpan.FromSeconds(10), TimeSpan.FromHours(6));

    public async Task SyncAsync()
    {
        try
        {
            // The admin's hidden list first: it applies to every buddy, built-in ones too (see BuddyLibrary.Hidden).
            var hidden = CloudCatalog.ParseHidden(await _http.GetStringAsync(CloudCatalog.ListUrl("buddies")));
            if (!hidden.SetEquals(lib.Hidden))
            {
                lib.Hidden = new HashSet<string>(hidden, StringComparer.Ordinal);
                HiddenList.Save(dataRoot, hidden);
                HiddenChanged?.Invoke();
            }

            var entries = CloudCatalog.Parse(await _http.GetStringAsync(CloudCatalog.ListUrl("catalog")));
            var state = Load();
            foreach (var e in entries)
            {
                if (hidden.Contains(e.Id)) continue;    // not downloaded while hidden; one already installed just isn't listed
                if (state.TryGetValue(e.Id, out var v) && v >= e.Version && lib.Find(e.Id)?.Id == e.Id) continue;
                try
                {
                    var bytes = await _http.GetByteArrayAsync(CloudCatalog.FileUrl(e.Prefix + "buddy.zip"));
                    using var zip = new MemoryStream(bytes);
                    lib.ImportZip(zip);
                    state[e.Id] = e.Version;
                }
                catch (Exception ex) when (ex is InvalidBuddyException or HttpRequestException or TaskCanceledException) { /* next time */ }
            }
            File.WriteAllText(_stateFile, JsonSerializer.Serialize(state));
        }
        catch (Exception) { /* offline or the service is unreachable: try again later */ }
    }

    private Dictionary<string, long> Load()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, long>>(File.ReadAllText(_stateFile)) ?? new(); }
        catch { return new(); }
    }

    public void Dispose() { _timer?.Dispose(); _http.Dispose(); }
}
