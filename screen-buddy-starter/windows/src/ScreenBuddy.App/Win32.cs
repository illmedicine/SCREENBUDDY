using System;
using System.Runtime.InteropServices;

namespace ScreenBuddy.App;

internal static class Win32
{
    private const int GWL_EXSTYLE = -20;
    public const long WS_EX_TOOLWINDOW = 0x00000080;     // keeps the buddy out of Alt-Tab and the taskbar
    public const long WS_EX_NOACTIVATE = 0x08000000;     // clicking the buddy doesn't steal focus from your work

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    // ---- global keyboard hook (used only to notice that *a* key went down; the key itself is never read) ----
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    private const int WH_KEYBOARD_LL = 13;
    public const int WM_KEYDOWN = 0x0100, WM_SYSKEYDOWN = 0x0104;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    public static IntPtr InstallKeyboardHook(HookProc proc) =>
        SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);

    public static void RemoveHook(IntPtr hook) => UnhookWindowsHookEx(hook);

    // ---- synthetic key press, for the --motiontest self-test only ----
    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUT
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT ki;      // 8 = offset on 64-bit, where the union is pointer-aligned
        [FieldOffset(32)] private readonly long _pad;   // the union's biggest member (mouse) is 32 bytes: SendInput insists on the full 40
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint n, INPUT[] inputs, int size);

    public static bool TapKey(ushort virtualKey)
    {
        var down = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = virtualKey } };
        var up = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = virtualKey, dwFlags = 0x0002 } };
        return SendInput(2, new[] { down, up }, Marshal.SizeOf<INPUT>()) == 2;
    }

    public static void AddExStyle(IntPtr hwnd, long flags)
    {
        var current = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
        SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(current | flags));
    }

    /// <summary>Puts a window exactly on a rectangle given in device pixels (works on any monitor at any scale), on top.</summary>
    public static void PlaceTopmost(IntPtr hwnd, int x, int y, int width, int height) =>
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);

    public static void Destroy(IntPtr hIcon) => DestroyIcon(hIcon);
}
