"""Regenerates every platform's app icon from the brand artwork.

    python tools/make_icons.py            (from screen-buddy-starter/, needs Pillow)

Source: branding/screen-buddy-art.webp, the holographic phone with a character stepping out of it. The square crop
below keeps the phone and character and leaves out the "Screen Buddy" wordmark, which can't be read at icon sizes.
Tiny sizes (32 px and below) use a closer crop of the character's upper body so there's still something to see.

To use new artwork, replace the source file (ideally a square of 1024 px or more), adjust CROP / CLOSE if the
composition moved, and run this again. Outputs, all committed:

  windows/src/ScreenBuddy.App/app.ico           exe, installer, taskbar and shortcut icon
  web/favicon.ico, web/icons/*.png              static favicon, home-screen and PWA icons
  android/app/src/main/res/mipmap-*/            launcher icon (adaptive on Android 8+, legacy PNGs below)
  macos/Resources/AppIcon.icns                  Mac app icon (scripts/build_app.sh copies it into the bundle)
"""
from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "branding" / "screen-buddy-art.webp"

CROP = (298, 34, 718, 454)    # phone + character, no wordmark (source is 1024 x 572)
CLOSE = (420, 62, 620, 262)   # head and shoulders coming out of the phone, for 32 px and below
SMALL = 32


def art() -> Image.Image:
    return Image.open(ART).convert("RGBA")


def square(src: Image.Image, size: int) -> Image.Image:
    box = CLOSE if size <= SMALL else CROP
    img = src.crop(box).resize((size, size), Image.LANCZOS)
    if size <= SMALL:   # a touch of extra contrast and sharpness so a 16 px icon isn't mush
        img = img.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=2))
    return img


def rounded(img: Image.Image, radius: float = 0.225) -> Image.Image:
    """Clips to a rounded square (drawn 4x larger and scaled down for smooth corners)."""
    n = img.width
    big = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, n * 4 - 1, n * 4 - 1), radius=n * 4 * radius, fill=255)
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel("A"), big.resize((n, n), Image.LANCZOS)))
    return out


def circle(img: Image.Image) -> Image.Image:
    n = img.width
    big = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(big).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
    out = img.copy()
    out.putalpha(big.resize((n, n), Image.LANCZOS))
    return out


def png(img: Image.Image) -> bytes:
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return b.getvalue()


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.width}x{img.height}")


def ico(images: list[Image.Image], path: Path) -> None:
    """A Windows .ico holding one PNG per size (Vista and later read these at every size)."""
    data = [png(i) for i in images]
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for img, blob in zip(images, data):
        n = 0 if img.width >= 256 else img.width
        entries += struct.pack("<BBBBHHII", n, n, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(head + entries + b"".join(data))
    print(f"  {path.relative_to(ROOT)}  {', '.join(str(i.width) for i in images)}")


def icns(src: Image.Image, path: Path) -> None:
    """A macOS .icns with PNG entries. The tile follows Apple's grid: 824 px rounded square in a 1024 canvas, soft shadow."""
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    tile = rounded(square(src, 824), radius=0.2237)
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 110), (100, 112), tile.getchannel("A"))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(tile, (100, 100))
    kinds = [("icp4", 16), ("icp5", 32), ("ic11", 32), ("ic12", 64), ("ic07", 128), ("ic13", 256),
             ("ic08", 256), ("ic14", 512), ("ic09", 512), ("ic10", 1024)]
    body = b""
    for kind, n in kinds:
        blob = png(canvas.resize((n, n), Image.LANCZOS))
        body += kind.encode() + struct.pack(">I", 8 + len(blob)) + blob
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(body)) + body)
    print(f"  {path.relative_to(ROOT)}  16-1024")


def android(src: Image.Image) -> None:
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, k in densities.items():
        legacy = square(src, round(48 * k))
        save(rounded(legacy, 0.2), res / f"mipmap-{name}" / "ic_launcher.png")
        save(circle(legacy), res / f"mipmap-{name}" / "ic_launcher_round.png")

        # Adaptive icon (Android 8+): the launcher masks a 108 dp square to its own shape and may show as little as
        # the middle 72 dp. The background is the artwork blurred to fill the corners; the foreground is the artwork
        # at 80 dp with feathered edges, so the phone and character are never clipped and there's no visible seam.
        full = round(108 * k)
        bg = square(src, full).filter(ImageFilter.GaussianBlur(full / 14))
        save(bg, res / f"mipmap-{name}" / "ic_launcher_background.png")
        inner = round(80 * k)
        fg_art = square(src, inner)
        feather = Image.new("L", (inner, inner), 0)
        edge = max(2, round(inner * 0.08))
        ImageDraw.Draw(feather).rounded_rectangle((edge, edge, inner - edge - 1, inner - edge - 1), radius=edge * 2, fill=255)
        fg_art.putalpha(feather.filter(ImageFilter.GaussianBlur(edge / 1.6)))
        fg = Image.new("RGBA", (full, full), (0, 0, 0, 0))
        fg.alpha_composite(fg_art, ((full - inner) // 2, (full - inner) // 2))
        save(fg, res / f"mipmap-{name}" / "ic_launcher_foreground.png")

    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/make_icons.py from branding/screen-buddy-art.webp. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
    for name in ("ic_launcher", "ic_launcher_round"):
        p = res / "mipmap-anydpi-v26" / f"{name}.xml"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(adaptive, encoding="utf-8")
        print(f"  {p.relative_to(ROOT)}")


def main() -> None:
    src = art()
    print("Windows")
    ico([rounded(square(src, n)) for n in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)],
        ROOT / "windows" / "src" / "ScreenBuddy.App" / "app.ico")
    print("Web")
    web = ROOT / "web"
    ico([rounded(square(src, n)) for n in (16, 32, 48)], web / "favicon.ico")
    for n in (32, 192, 512):
        save(rounded(square(src, n)), web / "icons" / f"icon-{n}.png")
    save(square(src, 180).convert("RGB"), web / "icons" / "apple-touch-icon.png")   # iOS rounds it itself
    save(square(src, 512), web / "icons" / "maskable-512.png")                     # full bleed for PWA masks
    print("Android")
    android(src)
    print("Mac")
    icns(src, ROOT / "macos" / "Resources" / "AppIcon.icns")


if __name__ == "__main__":
    main()
