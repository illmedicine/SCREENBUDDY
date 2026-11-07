using System.Text.Json;

namespace ScreenBuddy.Core;

/// <summary>What the user has chosen. Sizes are in device-independent pixels (1/96 inch), like WPF.</summary>
public sealed record AppSettings
{
    public const double MinHeight = 120, MaxHeight = 560, DefaultHeight = 260;
    public const int MinOpacity = 20;

    public string? BuddyId { get; init; }
    public double Height { get; init; } = DefaultHeight;
    /// <summary>20 to 100 percent, so the buddy can be made see-through over text.</summary>
    public int Opacity { get; init; } = 100;
    public bool Visible { get; init; } = true;
    /// <summary>Stand on the bottom edge of the screen (just above the taskbar) and slide along it.</summary>
    public bool StayOnBottom { get; init; }
    public bool Paused { get; init; }
    /// <summary>Top-left of the window in device-independent pixels, or null for the default bottom-right corner.</summary>
    public double? X { get; init; }
    public double? Y { get; init; }

    /// <summary>The same settings with every value forced into its allowed range.</summary>
    public AppSettings Clamped() => this with
    {
        Height = double.IsFinite(Height) ? Math.Clamp(Height, MinHeight, MaxHeight) : DefaultHeight,
        Opacity = Math.Clamp(Opacity, MinOpacity, 100),
        X = X is { } x && double.IsFinite(x) ? x : null,
        Y = Y is { } y && double.IsFinite(y) ? y : null,
    };
}

/// <summary>Reads and writes settings as JSON. A missing or damaged file just gives the defaults.</summary>
public sealed class SettingsStore(string path)
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public AppSettings Load()
    {
        try { return (JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) ?? new AppSettings()).Clamped(); }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException or NotSupportedException)
        {
            return new AppSettings();
        }
    }

    public void Save(AppSettings settings)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(settings.Clamped(), Options));
            File.Move(tmp, path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Settings are a convenience: if the disk says no, the app keeps working with what it has in memory.
        }
    }
}
