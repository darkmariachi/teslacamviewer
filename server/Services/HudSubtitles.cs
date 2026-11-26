using System.Globalization;
using System.Text;
using System.Text.Json;

namespace TeslaCam.Services;

/// <summary>One segment of the stored drive data (see <see cref="EventDriveData"/>), as read back for exports.</summary>
public class DriveDataSegment
{
    public int Index { get; set; }
    public double[] T { get; set; } = [];
    public double[] Speed { get; set; } = [];
    public int[] Gear { get; set; } = [];
    public double[] Pedal { get; set; } = [];
    public double[] Steer { get; set; } = [];
    public int[] Brake { get; set; } = [];
    public int[] Blinker { get; set; } = [];
    public int[] Autopilot { get; set; } = [];
    public double[] Heading { get; set; } = [];
    public double[] Accel { get; set; } = [];
    public double[] Lateral { get; set; } = [];

    public static List<DriveDataSegment> Load(string path)
    {
        using var stream = File.OpenRead(path);
        using var doc = JsonDocument.Parse(stream);
        return doc.RootElement.GetProperty("segments").Deserialize<List<DriveDataSegment>>(JsonSerializerOptions.Web) ?? [];
    }
}

/// <summary>
/// Draws the player's driving data HUD into an export, as an ASS subtitle file that ffmpeg's ass filter burns in:
/// a dark rounded panel along the bottom with the speed, gear, turn signals, pedals, steering wheel, heading and
/// g-force. Only what changes gets a new subtitle line, so a minute of data stays a few hundred lines.
/// </summary>
public static class HudSubtitles
{
    // ASS colours are &HBBGGRR; transparency is a separate tag (\1a, 00 opaque to FF invisible), so each fill below
    // sets both and can follow another in the same line.
    private const string WhiteRgb = "&HFFFFFF&";
    private const string BlueRgb = "&HFF9B7B&";
    private const string White = WhiteRgb + @"\1a&H00&";
    private const string Dim = WhiteRgb + @"\1a&HA8&";
    private const string Off = WhiteRgb + @"\1a&HD0&";
    private const string Green = @"&H58D130&\1a&H00&";
    private const string Red = @"&H433DFF&\1a&H00&";
    private const string Blue = BlueRgb + @"\1a&H00&";
    private const double BlinkHalf = 0.35;

    /// <summary>
    /// Builds the subtitle file for one part of an export: <paramref name="from"/> seconds into the segment, for
    /// <paramref name="duration"/> seconds, on a frame of <paramref name="width"/> × <paramref name="height"/>.
    /// Returns null when the segment has no data in that stretch.
    /// </summary>
    public static string? Build(DriveDataSegment seg, double from, double duration, int width, int height, bool mph)
    {
        var to = from + duration;
        // Readings that cover the stretch: each lasts until the next, and the last one for at most a second.
        var idx = Enumerable.Range(0, seg.T.Length)
            .Where(i => seg.T[i] < to && (i + 1 < seg.T.Length ? seg.T[i + 1] > from : seg.T[i] + 1 > from)).ToList();
        if (idx.Count == 0) return null;

        // Sized from the frame width so a grid gets a HUD in proportion to the whole picture.
        var s = Math.Clamp(width / 1600.0, 0.45, 2.2);
        double U(double v) => Math.Round(v * s, 1);
        var boxW = U(560);
        var boxH = U(84);
        var left = Math.Round((width - boxW) / 2, 1);
        var top = Math.Round(height - boxH - U(24), 1);
        double X(double v) => Math.Round(left + v * s, 1);
        double Y(double v) => Math.Round(top + v * s, 1);
        var mid = Y(42);

        var lines = new List<(double Start, double End, int Layer, string Text)>();
        void Static(int layer, string text) => lines.Add((0, duration, layer, text));
        void Track(int layer, Func<int, string> render)
        {
            string? current = null;
            double start = 0;
            foreach (var i in idx)
            {
                var at = Math.Max(0, seg.T[i] - from);
                var text = render(i);
                if (text == current) continue;
                if (current != null) lines.Add((start, at, layer, current));
                current = text;
                start = at;
            }
            if (current != null) lines.Add((start, duration, layer, current));
        }

        // The panel.
        Static(0, $"{{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H000000&\\1a&H70&\\p1}}{RoundRect(left, top, boxW, boxH, U(18))}{{\\p0}}");

        // Speed and unit.
        var factor = mph ? 2.23694 : 3.6;
        Track(2, i => Text(X(100), Y(36), U(44), true, White, Math.Round(seg.Speed[i] * factor).ToString(CultureInfo.InvariantCulture)));
        Static(2, Text(X(100), Y(66), U(13), false, Dim, mph ? "mph" : "km/h"));

        // Gear, as P R N D with the current one lit.
        Track(2, i =>
        {
            var gear = seg.Gear[i] switch { 0 => 'P', 1 => 'D', 2 => 'R', 3 => 'N', _ => ' ' };
            var sb = new StringBuilder($"{{\\an5\\pos({F(X(178))},{F(mid)})\\fs{F(U(16))}\\b1\\bord0\\shad0\\fnDejaVu Sans}}");
            foreach (var g in "PRND") sb.Append($"{{\\1c{(g == gear ? White : Dim)}}}{g} ");
            return sb.ToString().TrimEnd();
        });

        // Accelerator (green, filled to its travel) and brake (red while pressed).
        var barH = U(40);
        var barTop = Math.Round(mid - barH / 2, 1);
        Static(1, Shape(Dim, RoundRect(X(228), barTop, U(7), barH, U(3.5))));
        Track(2, i =>
        {
            var h = Math.Round(barH * Math.Clamp(seg.Pedal[i], 0, 100) / 100, 1);
            return h < 0.5 ? "" : Shape(Green, RoundRect(X(228), barTop + barH - h, U(7), h, Math.Min(h / 2, U(3.5))));
        });
        Track(2, i => Shape(seg.Brake[i] == 1 ? Red : Dim, RoundRect(X(240), barTop, U(7), barH, U(3.5))));

        // Steering wheel, turned like the car's (positive is right, which is clockwise; ASS turns the other way).
        var cx = X(290);
        var r = U(15);
        Track(2, i =>
        {
            var angle = Math.Round(Math.Clamp(seg.Steer[i], -540, 540) / 2) * 2;
            var steered = seg.Autopilot[i] > 0;
            var colour = steered ? Blue : White;
            var rot = $"\\org({F(cx)},{F(mid)})\\frz{F(-angle)}";
            var ring = $"{{\\an7\\pos(0,0)\\bord{F(U(2.2))}\\shad0\\1a&HFF&\\3c{(steered ? BlueRgb : WhiteRgb)}{rot}\\p1}}{Circle(cx, mid, r)}{{\\p0}}";
            var hub = $"{{\\an7\\pos(0,0)\\bord0\\shad0\\1c{colour}{rot}\\p1}}{Circle(cx, mid, U(2.6))} " +
                      $"{Rect(cx - r, mid - U(2.2), r - U(4), U(2.4))} {Rect(cx + U(4), mid - U(2.2), r - U(4), U(2.4))} " +
                      $"{Rect(cx - U(1.2), mid + U(4), U(2.4), r - U(4))}{{\\p0}}";
            return ring + "\\N" + hub;
        });

        // Heading.
        Track(2, i => Text(X(352), Y(34), U(16), true, White, Compass(seg.Heading[i])));
        Track(2, i => Text(X(352), Y(54), U(11), false, Dim, $"{Math.Round((seg.Heading[i] % 360 + 360) % 360)}°"));

        // g-force: a dot in a ring of 0.5 g (up is forward), and the forward figure.
        var gx = X(410);
        var gr = U(14);
        Static(1, $"{{\\an7\\pos(0,0)\\bord{F(U(1.3))}\\shad0\\1a&HFF&\\3c&HFFFFFF&\\3a&HA8&\\p1}}{Circle(gx, mid, gr)}{{\\p0}}");
        Track(2, i =>
        {
            var fwd = seg.Accel[i] / 9.80665;
            var side = seg.Lateral[i] / 9.80665;
            double dx = side * gr / 0.5, dy = -fwd * gr / 0.5;
            var len = Math.Sqrt(dx * dx + dy * dy);
            if (len > gr)
            {
                dx = dx / len * gr;
                dy = dy / len * gr;
            }
            return Shape(White, Circle(Math.Round(gx + dx), Math.Round(mid + dy), U(3.2)));
        });
        Track(2, i =>
        {
            var g = seg.Accel[i] / 9.80665;
            return Text(X(462), mid, U(13), false, White, $"{(g >= 0 ? "+" : "−")}{Math.Abs(g):0.00}g");
        });

        // Turn signals, flashing while on.
        foreach (var (bit, x, leftward) in new[] { (1, 34.0, true), (2, 526.0, false) })
        {
            var arrow = Arrow(X(x), mid, U(11), leftward);
            var runStart = -1.0;
            string? current = null;
            double start = 0;
            void Emit(double at, string text)
            {
                if (text == current) return;
                if (current != null) lines.Add((start, at, 2, current));
                current = text;
                start = at;
            }
            foreach (var i in idx)
            {
                var at = Math.Max(0, seg.T[i] - from);
                var next = i + 1 < seg.T.Length ? Math.Min(duration, seg.T[i + 1] - from) : duration;
                if ((seg.Blinker[i] & bit) == 0)
                {
                    runStart = -1;
                    Emit(at, Shape(Off, arrow));
                    continue;
                }
                if (runStart < 0) runStart = at;
                // Flash in steps of BlinkHalf from the start of the run, splitting this reading where it changes.
                for (var t = at; t < next - 0.001;)
                {
                    // The small nudge keeps a time that lands on a flash boundary from rounding back into the last flash.
                    var phase = (int)Math.Floor((t - runStart) / BlinkHalf + 1e-6);
                    Emit(t, Shape(phase % 2 == 0 ? Green : Off, arrow));
                    t = Math.Max(t + 0.01, Math.Min(next, runStart + (phase + 1) * BlinkHalf));
                }
            }
            if (current != null) lines.Add((start, duration, 2, current));
        }

        var sb = new StringBuilder();
        sb.Append("[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\n");
        sb.Append($"PlayResX: {width}\nPlayResY: {height}\n\n");
        sb.Append("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
        sb.Append("Style: Hud,DejaVu Sans,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n");
        sb.Append("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
        foreach (var (start, end, layer, text) in lines)
        {
            if (end - start < 0.005 || text.Length == 0) continue;
            // A "\N" joins two drawings that share a moment; each becomes its own line.
            foreach (var part in text.Split("\\N"))
                sb.Append($"Dialogue: {layer},{Time(start)},{Time(end)},Hud,,0,0,0,,{part}\n");
        }
        return sb.ToString();
    }

    private static string Text(double x, double y, double size, bool bold, string colour, string text) =>
        $"{{\\an5\\pos({F(x)},{F(y)})\\fs{F(size)}\\b{(bold ? 1 : 0)}\\bord0\\shad0\\1c{colour}\\fnDejaVu Sans}}{text}";

    private static string Shape(string colour, string path) => $"{{\\an7\\pos(0,0)\\bord0\\shad0\\1c{colour}\\p1}}{path}{{\\p0}}";

    private static string Rect(double x, double y, double w, double h) =>
        $"m {F(x)} {F(y)} l {F(x + w)} {F(y)} {F(x + w)} {F(y + h)} {F(x)} {F(y + h)}";

    private static string RoundRect(double x, double y, double w, double h, double r)
    {
        r = Math.Min(r, Math.Min(w, h) / 2);
        var k = r * 0.4477;
        return $"m {F(x + r)} {F(y)} l {F(x + w - r)} {F(y)} b {F(x + w - k)} {F(y)} {F(x + w)} {F(y + k)} {F(x + w)} {F(y + r)} " +
               $"l {F(x + w)} {F(y + h - r)} b {F(x + w)} {F(y + h - k)} {F(x + w - k)} {F(y + h)} {F(x + w - r)} {F(y + h)} " +
               $"l {F(x + r)} {F(y + h)} b {F(x + k)} {F(y + h)} {F(x)} {F(y + h - k)} {F(x)} {F(y + h - r)} " +
               $"l {F(x)} {F(y + r)} b {F(x)} {F(y + k)} {F(x + k)} {F(y)} {F(x + r)} {F(y)}";
    }

    private static string Circle(double cx, double cy, double r)
    {
        var k = r * 0.5523;
        return $"m {F(cx)} {F(cy - r)} b {F(cx + k)} {F(cy - r)} {F(cx + r)} {F(cy - k)} {F(cx + r)} {F(cy)} " +
               $"b {F(cx + r)} {F(cy + k)} {F(cx + k)} {F(cy + r)} {F(cx)} {F(cy + r)} " +
               $"b {F(cx - k)} {F(cy + r)} {F(cx - r)} {F(cy + k)} {F(cx - r)} {F(cy)} " +
               $"b {F(cx - r)} {F(cy - k)} {F(cx - k)} {F(cy - r)} {F(cx)} {F(cy - r)}";
    }

    private static string Arrow(double cx, double cy, double size, bool leftward)
    {
        var d = leftward ? -1 : 1;
        var tip = cx + d * size;
        var back = cx - d * size;
        return $"m {F(tip)} {F(cy)} l {F(cx)} {F(cy - size * 0.75)} {F(cx)} {F(cy - size * 0.32)} {F(back)} {F(cy - size * 0.32)} " +
               $"{F(back)} {F(cy + size * 0.32)} {F(cx)} {F(cy + size * 0.32)} {F(cx)} {F(cy + size * 0.75)}";
    }

    private static readonly string[] Points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    public static string Compass(double deg) => Points[(int)Math.Round((deg % 360 + 360) % 360 / 45) % 8];

    private static string Time(double seconds)
    {
        var cs = (long)Math.Round(seconds * 100);
        return $"{cs / 360000}:{cs / 6000 % 60:00}:{cs / 100 % 60:00}.{cs % 100:00}";
    }

    private static string F(double v) => v.ToString("0.#", CultureInfo.InvariantCulture);
}
