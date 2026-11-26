using System.Buffers.Binary;
using System.Text;
using Microsoft.EntityFrameworkCore;
using TeslaCam.Data;
using TeslaCam.Services;

namespace TeslaCam.Tests;

/// <summary>
/// Reads the driving data Tesla embeds in its clips, from small MP4 files built here: a video track whose samples
/// each hold an SEI message in Tesla's layout followed by a dummy picture.
/// </summary>
public sealed class DriveDataTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "teslacam-tests", Guid.NewGuid().ToString("N"));

    public DriveDataTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    // Made-up place, as in the other tests.
    private const double Lat = 30.267;
    private const double Lon = -97.78;

    [Fact]
    public void Reads_every_frame_with_its_time()
    {
        var path = WriteClip("drive.mp4", Enumerable.Range(0, 30).Select(i => Frame(speed: i, lat: Lat + i * 1e-4, lon: Lon)).ToList());

        var frames = DriveData.ReadClip(path);

        Assert.Equal(30, frames.Count);
        Assert.Equal(0, frames[0].T, 3);
        Assert.Equal(1.0 / 30 * 29, frames[^1].T, 3);
        Assert.Equal(29, frames[^1].SpeedMps, 3);
        Assert.Equal(Lat + 29e-4, frames[^1].Lat!.Value, 6);
        Assert.Equal(Lon, frames[^1].Lon!.Value, 6);
    }

    [Fact]
    public void Decodes_each_field()
    {
        var path = WriteClip("fields.mp4", [Frame(gear: 2, speed: 12.5f, pedal: 40, steering: -15.5f, left: true, brake: true, autopilot: 2,
            lat: Lat, lon: Lon, heading: 270, ax: 0.3, ay: -1.2)]);

        var f = Assert.Single(DriveData.ReadClip(path));

        Assert.Equal(2, f.Gear);
        Assert.Equal(12.5f, f.SpeedMps);
        Assert.Equal(40f, f.PedalPct);
        Assert.Equal(-15.5f, f.SteeringDeg);
        Assert.True(f.BlinkerLeft);
        Assert.False(f.BlinkerRight);
        Assert.True(f.Brake);
        Assert.Equal(2, f.Autopilot);
        Assert.Equal(270, f.HeadingDeg);
        Assert.Equal(0.3, f.AccelX);
        Assert.Equal(-1.2, f.AccelY);
    }

    [Fact]
    public void Undoes_emulation_prevention_bytes()
    {
        // A heading of exactly zero is eight zero bytes, which the encoder must break up with 03 bytes.
        var path = WriteClip("zeros.mp4", [Frame(speed: 3, heading: 0, lat: Lat, lon: Lon)]);

        var f = Assert.Single(DriveData.ReadClip(path));

        Assert.Equal(0, f.HeadingDeg);
        Assert.Equal(Lat, f.Lat!.Value, 6);
    }

    [Fact]
    public void A_missing_fix_reads_as_no_position()
    {
        var f = Assert.Single(DriveData.ReadClip(WriteClip("nofix.mp4", [Frame(speed: 1, lat: 0, lon: 0)])));

        Assert.Null(f.Lat);
        Assert.Null(f.Lon);
    }

    [Fact]
    public void A_clip_without_drive_data_comes_back_empty()
    {
        var path = WriteClip("parked.mp4", Enumerable.Range(0, 20).Select(_ => (byte[]?)null).ToList());

        Assert.Empty(DriveData.ReadClip(path));
        Assert.Empty(DriveData.ReadClip(path, quick: false));
    }

    [Fact]
    public void Something_that_is_not_an_mp4_comes_back_empty()
    {
        var path = Path.Combine(_root, "junk.mp4");
        File.WriteAllBytes(path, Encoding.ASCII.GetBytes("not a video at all"));

        Assert.Empty(DriveData.ReadClip(path));
    }

    [Fact]
    public void Build_keeps_ten_readings_a_second_and_a_thinned_route()
    {
        // 60 frames a second for two seconds, driving north about 1 m per frame.
        var frames = Enumerable.Range(0, 120)
            .Select(i => new DriveFrame(i / 60.0, 1, 10, 20, 0, false, false, false, 0, Lat + i * 9e-6, Lon, 0, 0, -1))
            .ToList();

        var result = EventDriveData.Build([(0, frames)])!;

        Assert.NotNull(result);
        using var doc = System.Text.Json.JsonDocument.Parse(result.Json);
        var seg = doc.RootElement.GetProperty("segments")[0];
        Assert.Equal(20, seg.GetProperty("t").GetArrayLength());
        // Forward acceleration is the car's -y.
        Assert.Equal(1, seg.GetProperty("accel")[0].GetDouble());
        Assert.Equal(Lat, result.Start!.Value.Lat, 6);
        Assert.Equal(Lat + 119 * 9e-6, result.End!.Value.Lat, 6);
        // About 120 m of driving with a point every 25 m or more, plus the end.
        Assert.InRange(result.Route.Count, 4, 7);
        Assert.Equal(Math.Round(Lat + 119 * 9e-6, 5), result.Route[^1][1]);
    }

    [Fact]
    public void Build_returns_nothing_without_frames() => Assert.Null(EventDriveData.Build([(0, [])]));

    [Fact]
    public async Task A_drive_borrows_the_nearest_event_json_city_only()
    {
        var file = Path.Combine(_root, "test.db");
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={file};Pooling=False").Options;
        await using var db = new AppDb(options);
        await db.Database.MigrateAsync();
        db.Events.AddRange(
            new Event { Name = "far", City = "Elsewhere", Lat = Lat + 1, Lon = Lon, TriggerTime = DateTime.Now },
            new Event { Name = "near", City = "Riverside", Lat = Lat + 0.01, Lon = Lon, TriggerTime = DateTime.Now },
            // A name another drive borrowed doesn't count, even closer.
            new Event { Type = EventType.Recent, Name = "drive", City = "Borrowed", Lat = Lat, Lon = Lon + 0.001 });
        await db.SaveChangesAsync();

        Assert.Equal("Riverside", await EventDriveData.NearestCityAsync(db, 0, Lat, Lon, CancellationToken.None));
        Assert.Null(await EventDriveData.NearestCityAsync(db, 0, Lat - 1, Lon, CancellationToken.None));
    }

    private static DriveDataSegment Segment(int count, double step, Func<int, int> blinker)
    {
        var range = Enumerable.Range(0, count).ToArray();
        return new DriveDataSegment
        {
            Index = 0,
            T = range.Select(i => Math.Round(i * step, 2)).ToArray(),
            Speed = range.Select(_ => 10.0).ToArray(),
            Gear = range.Select(_ => 1).ToArray(),
            Pedal = range.Select(_ => 30.0).ToArray(),
            Steer = range.Select(i => (double)i).ToArray(),
            Brake = range.Select(_ => 0).ToArray(),
            Blinker = range.Select(blinker).ToArray(),
            Autopilot = range.Select(_ => 0).ToArray(),
            Heading = range.Select(_ => 90.0).ToArray(),
            Accel = range.Select(_ => 0.5).ToArray(),
            Lateral = range.Select(_ => 0.0).ToArray(),
        };
    }

    [Fact]
    public void Hud_shows_speed_in_the_chosen_unit_and_lights_the_gear()
    {
        var seg = Segment(50, 0.1, _ => 0);

        var mph = HudSubtitles.Build(seg, 0, 5, 1280, 960, mph: true)!;
        var kmh = HudSubtitles.Build(seg, 0, 5, 1280, 960, mph: false)!;

        Assert.Contains("PlayResX: 1280", mph);
        Assert.Contains("}22", mph);   // 10 m/s
        Assert.Contains("}36", kmh);
        Assert.Contains("km/h", kmh);
        // D is the lit one: full white right before it.
        Assert.Contains(@"\1c&HFFFFFF&\1a&H00&}D", mph);
    }

    [Fact]
    public void Hud_flashes_a_turn_signal_even_when_readings_land_on_flash_boundaries()
    {
        // Readings exactly one flash apart used to round back onto the same boundary and never finish.
        var seg = Segment(40, 0.35, _ => 1);

        var ass = HudSubtitles.Build(seg, 0, 13, 1280, 960, mph: true)!;

        var green = ass.Split('\n').Count(l => l.Contains("&H58D130&"));
        Assert.InRange(green, 15, 25);
    }

    [Fact]
    public void Hud_is_skipped_for_a_stretch_without_data() =>
        Assert.Null(HudSubtitles.Build(Segment(10, 0.1, _ => 0), 30, 5, 1280, 960, mph: true));

    // ---- building test clips ----

    private static byte[] Frame(int gear = 1, float speed = 0, float pedal = 0, float steering = 0, bool left = false, bool right = false,
        bool brake = false, int autopilot = 0, double lat = Lat, double lon = Lon, double heading = 90, double ax = 0, double ay = 0)
    {
        var p = new List<byte>();
        void Varint(ulong v)
        {
            while (v >= 0x80)
            {
                p.Add((byte)(v | 0x80));
                v >>= 7;
            }
            p.Add((byte)v);
        }
        void Key(int field, int wire) => Varint((ulong)(field << 3 | wire));
        void Int(int field, long v) { Key(field, 0); Varint((ulong)v); }
        void F32(int field, float v) { Key(field, 5); var b = new byte[4]; BinaryPrimitives.WriteSingleLittleEndian(b, v); p.AddRange(b); }
        void F64(int field, double v) { Key(field, 1); var b = new byte[8]; BinaryPrimitives.WriteDoubleLittleEndian(b, v); p.AddRange(b); }

        Int(1, 1);
        Int(2, gear);
        Int(3, 1234);
        F32(4, speed);
        F32(5, pedal);
        F32(6, steering);
        Int(7, left ? 1 : 0);
        Int(8, right ? 1 : 0);
        Int(9, brake ? 1 : 0);
        Int(10, autopilot);
        F64(11, lat);
        F64(12, lon);
        F64(13, heading);
        F64(14, ax);
        F64(15, ay);
        F64(16, 0.1);
        return [.. p];
    }

    /// <summary>One SEI NAL unit (header byte included) carrying a protobuf in Tesla's wrapping, escaped as H.264 requires.</summary>
    private static byte[] SeiNal(byte[] proto)
    {
        var payload = new List<byte> { 0x42, 0x42, 0x42, 0x69 };
        payload.AddRange(proto);
        var rbsp = new List<byte> { 5 };
        var size = payload.Count;
        while (size >= 255) { rbsp.Add(0xFF); size -= 255; }
        rbsp.Add((byte)size);
        rbsp.AddRange(payload);
        rbsp.Add(0x80);

        var nal = new List<byte> { 0x06 };
        var zeros = 0;
        foreach (var b in rbsp)
        {
            if (zeros >= 2 && b <= 3)
            {
                nal.Add(3);
                zeros = 0;
            }
            nal.Add(b);
            zeros = b == 0 ? zeros + 1 : 0;
        }
        return [.. nal];
    }

    /// <summary>Writes an MP4 with one video track at 30 fps; each sample is an optional SEI and a small picture slice.</summary>
    private string WriteClip(string name, List<byte[]?> frames)
    {
        var samples = frames.Select(proto =>
        {
            var s = new List<byte>();
            if (proto != null) AddNal(s, SeiNal(proto));
            AddNal(s, [0x01, 0x9A, 0x00, 0x11, 0x22]);
            return s.ToArray();
        }).ToList();

        var ftyp = Box("ftyp", [.. "isom"u8, 0, 0, 2, 0, .. "isom"u8]);
        var mdatBody = samples.SelectMany(s => s).ToArray();
        var mdatStart = ftyp.Length + 8;

        var stsd = Box("stsd", [.. U32(0), .. U32(1), .. Box("avc1", [.. new byte[78], .. Box("avcC", [1, 0x64, 0, 0x28, 0xFF, 0xE0, 0])])]);
        var stts = Box("stts", [.. U32(0), .. U32(1), .. U32((uint)samples.Count), .. U32(1000)]);
        var stsz = Box("stsz", [.. U32(0), .. U32(0), .. U32((uint)samples.Count), .. samples.SelectMany(s => U32((uint)s.Length))]);
        var stsc = Box("stsc", [.. U32(0), .. U32(1), .. U32(1), .. U32((uint)samples.Count), .. U32(1)]);
        var stco = Box("stco", [.. U32(0), .. U32(1), .. U32((uint)mdatStart)]);
        var stbl = Box("stbl", [.. stsd, .. stts, .. stsz, .. stsc, .. stco]);
        var mdhd = Box("mdhd", [.. U32(0), .. U32(0), .. U32(0), .. U32(30000), .. U32((uint)(samples.Count * 1000)), 0, 0, 0, 0]);
        var hdlr = Box("hdlr", [.. U32(0), .. U32(0), .. "vide"u8, .. new byte[12], 0]);
        var mdia = Box("mdia", [.. mdhd, .. hdlr, .. Box("minf", stbl)]);
        var moov = Box("moov", Box("trak", mdia));

        var path = Path.Combine(_root, name);
        File.WriteAllBytes(path, [.. ftyp, .. Box("mdat", mdatBody), .. moov]);
        return path;
    }

    private static void AddNal(List<byte> sample, byte[] nal)
    {
        sample.AddRange(U32((uint)nal.Length));
        sample.AddRange(nal);
    }

    private static byte[] U32(uint v)
    {
        var b = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(b, v);
        return b;
    }

    private static byte[] Box(string type, byte[] body) => [.. U32((uint)(body.Length + 8)), .. Encoding.ASCII.GetBytes(type), .. body];
}
