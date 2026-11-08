using ScreenBuddy.Core;
using Xunit;

namespace ScreenBuddy.Core.Tests;

public class BrandMarkTests
{
    /// <summary>A w x h alpha map with a figure: a narrow head on top of a wider body (same as the web test).</summary>
    private static byte[] Figure(int w, int h, int headX, int top, int bottom, int headW = 10, int bodyW = 30)
    {
        var a = new byte[w * h];
        var headBottom = top + (int)Math.Round((bottom - top) / 6.0);
        for (var y = top; y <= bottom; y++)
        {
            var half = (y <= headBottom ? headW : bodyW) / 2.0;
            for (var x = (int)Math.Round(headX - half); x < (int)Math.Round(headX + half); x++)
                if (x >= 0 && x < w) a[y * w + x] = 255;
        }
        return a;
    }

    [Fact]
    public void FramesHeadToWaistCentredOnTheHead()
    {
        var r = BrandMark.BustRect(Figure(200, 370, headX: 100, top: 40, bottom: 360), 200, 370)!.Value;
        Assert.Equal((int)Math.Round(321 * 0.56), r.Size);
        Assert.InRange(r.X + r.Size / 2.0, 99, 101);
        Assert.InRange(r.Y, 40 - r.Size * 0.06, 40);
    }

    [Theory]
    [InlineData(4, 2, 368)]
    [InlineData(196, 0, 369)]
    [InlineData(100, 300, 369)]
    public void StaysInsideTheFrame(int headX, int top, int bottom)
    {
        var r = BrandMark.BustRect(Figure(200, 370, headX, top, bottom), 200, 370)!.Value;
        Assert.True(r.X >= 0 && r.Y >= 0 && r.X + r.Size <= 200 && r.Y + r.Size <= 370);
    }

    [Fact]
    public void EmptyOrFaintFramesHaveNoBust()
    {
        Assert.Null(BrandMark.BustRect(new byte[50 * 50], 50, 50));
        Assert.Null(BrandMark.BustRect(Enumerable.Repeat((byte)20, 50 * 50).ToArray(), 50, 50));
        Assert.Null(BrandMark.BustRect(new byte[10], 50, 50));     // too short for the size given
    }

    [Fact]
    public void FindsABustInEveryShippedBuddyFrameShape()
    {
        // A centred figure filling most of the frame, like the shipped strips (cw x ch around 200 x 370).
        var r = BrandMark.BustRect(Figure(213, 353, headX: 106, top: 10, bottom: 350), 213, 353);
        Assert.NotNull(r);
        Assert.True(r!.Value.Size > 100);
    }
}
