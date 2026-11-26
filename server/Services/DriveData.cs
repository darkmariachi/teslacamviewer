using System.Buffers.Binary;
using System.Text;

namespace TeslaCam.Services;

/// <summary>One video frame's worth of the driving data the car writes into its clips.</summary>
public record DriveFrame(
    double T,
    int Gear,
    float SpeedMps,
    float PedalPct,
    float SteeringDeg,
    bool BlinkerLeft,
    bool BlinkerRight,
    bool Brake,
    int Autopilot,
    double? Lat,
    double? Lon,
    double HeadingDeg,
    double AccelX,
    double AccelY);

/// <summary>
/// Reads the driving data Tesla firmware embeds in each video frame (speed, gear, pedal, steering, signals,
/// Autopilot, GPS, heading, acceleration). The car stores it as an H.264 SEI message (user data unregistered)
/// in front of every frame: a run of 0x42 bytes, 0x69, then a protobuf message, as in Tesla's published
/// dashcam.proto. Clips recorded while parked, and clips from older firmware, have none.
/// </summary>
public static class DriveData
{
    /// <summary>
    /// Reads every frame's data from one clip, ordered by presentation time in seconds from the clip's start.
    /// With <paramref name="quick"/> it only looks at a handful of frames and returns an empty list when none of
    /// them carry data, so clips without any are skipped without reading them through.
    /// </summary>
    public static List<DriveFrame> ReadClip(string path, bool quick = true)
    {
        using var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 4096, FileOptions.RandomAccess);
        var table = SampleTable.Read(f);
        if (table == null || table.Count == 0) return [];

        if (quick)
        {
            // Driving data is on every frame while the car is awake, so a few frames spread over the clip say
            // whether there is any; parked Sentry footage has none.
            var probes = new[] { 0, table.Count / 4, table.Count / 2, table.Count * 3 / 4, table.Count - 1 }.Distinct();
            if (!probes.Any(i => ReadSample(f, table, i) != null)) return [];
        }

        var frames = new List<DriveFrame>(table.Count);
        for (var i = 0; i < table.Count; i++)
            if (ReadSample(f, table, i) is { } frame) frames.Add(frame);
        frames.Sort((a, b) => a.T.CompareTo(b.T));
        return frames;
    }

    private static DriveFrame? ReadSample(FileStream f, SampleTable table, int index)
    {
        var offset = table.Offsets[index];
        var end = offset + table.Sizes[index];
        var lenSize = table.NalLengthSize;
        Span<byte> head = stackalloc byte[4];
        // The SEI comes before the picture in each sample, so stop at the first slice.
        while (offset + lenSize + 1 <= end)
        {
            f.Position = offset;
            if (f.Read(head[..lenSize]) != lenSize) return null;
            long n = 0;
            for (var k = 0; k < lenSize; k++) n = (n << 8) | head[k];
            if (n <= 0 || offset + lenSize + n > end) return null;
            var typeByte = f.ReadByte();
            if (typeByte < 0) return null;
            var type = typeByte & 0x1F;
            if (type is 1 or 5) return null;
            if (type == 6 && n < 4096)
            {
                var nal = new byte[n - 1];
                if (f.Read(nal) != nal.Length) return null;
                if (ParseSei(Unescape(nal)) is { } frame) return frame with { T = table.Times[index] };
            }
            offset += lenSize + n;
        }
        return null;
    }

    /// <summary>Removes H.264 emulation prevention bytes (00 00 03 → 00 00).</summary>
    public static byte[] Unescape(ReadOnlySpan<byte> data)
    {
        var output = new byte[data.Length];
        int o = 0, zeros = 0;
        foreach (var b in data)
        {
            if (zeros >= 2 && b == 3)
            {
                zeros = 0;
                continue;
            }
            output[o++] = b;
            zeros = b == 0 ? zeros + 1 : 0;
        }
        return output[..o];
    }

    /// <summary>Parses SEI messages (without the NAL header byte) and decodes Tesla's, if present.</summary>
    public static DriveFrame? ParseSei(ReadOnlySpan<byte> rbsp)
    {
        var i = 0;
        while (i < rbsp.Length && rbsp[i] != 0x80)
        {
            int type = 0, size = 0;
            while (i < rbsp.Length && rbsp[i] == 0xFF) { type += 255; i++; }
            if (i >= rbsp.Length) return null;
            type += rbsp[i++];
            while (i < rbsp.Length && rbsp[i] == 0xFF) { size += 255; i++; }
            if (i >= rbsp.Length) return null;
            size += rbsp[i++];
            if (i + size > rbsp.Length) return null;
            var payload = rbsp.Slice(i, size);
            i += size;
            if (type != 5) continue;
            var j = 0;
            while (j < payload.Length && payload[j] == 0x42) j++;
            if (j == 0 || j >= payload.Length || payload[j] != 0x69) continue;
            return Decode(payload[(j + 1)..]);
        }
        return null;
    }

    /// <summary>Decodes Tesla's SeiMetadata protobuf. Field numbers follow Tesla's dashcam.proto.</summary>
    public static DriveFrame? Decode(ReadOnlySpan<byte> p)
    {
        int gear = 0, autopilot = 0;
        float speed = 0, pedal = 0, steering = 0;
        bool left = false, right = false, brake = false;
        double lat = 0, lon = 0, heading = 0, ax = 0, ay = 0;
        var i = 0;
        var any = false;
        while (i < p.Length)
        {
            if (!Varint(p, ref i, out var key)) return null;
            var field = (int)(key >> 3);
            switch (key & 7)
            {
                case 0:
                    if (!Varint(p, ref i, out var v)) return null;
                    switch (field)
                    {
                        case 2: gear = (int)v; break;
                        case 7: left = v != 0; break;
                        case 8: right = v != 0; break;
                        case 9: brake = v != 0; break;
                        case 10: autopilot = (int)v; break;
                    }
                    break;
                case 1:
                    if (i + 8 > p.Length) return null;
                    var d = BinaryPrimitives.ReadDoubleLittleEndian(p.Slice(i, 8));
                    i += 8;
                    switch (field)
                    {
                        case 11: lat = d; break;
                        case 12: lon = d; break;
                        case 13: heading = d; break;
                        case 14: ax = d; break;
                        case 15: ay = d; break;
                    }
                    break;
                case 5:
                    if (i + 4 > p.Length) return null;
                    var s = BinaryPrimitives.ReadSingleLittleEndian(p.Slice(i, 4));
                    i += 4;
                    switch (field)
                    {
                        case 4: speed = s; break;
                        case 5: pedal = s; break;
                        case 6: steering = s; break;
                    }
                    break;
                case 2:
                    if (!Varint(p, ref i, out var len) || i + (long)len > p.Length) return null;
                    i += (int)len;
                    break;
                default:
                    return null;
            }
            any = true;
        }
        if (!any) return null;
        // No fix reads as zeros.
        var located = Math.Abs(lat) <= 90 && Math.Abs(lon) <= 180 && (Math.Abs(lat) > 1e-4 || Math.Abs(lon) > 1e-4);
        return new DriveFrame(0, gear, Math.Max(0, speed), pedal, steering, left, right, brake, autopilot,
            located ? lat : null, located ? lon : null, heading, ax, ay);
    }

    private static bool Varint(ReadOnlySpan<byte> p, ref int i, out ulong value)
    {
        value = 0;
        for (var shift = 0; shift < 64 && i < p.Length; shift += 7)
        {
            var b = p[i++];
            value |= (ulong)(b & 0x7F) << shift;
            if (b < 0x80) return true;
        }
        return false;
    }

    /// <summary>Where each video sample sits in the file and when it is shown, from the MP4's sample tables.</summary>
    private sealed class SampleTable
    {
        public long[] Offsets = [];
        public int[] Sizes = [];
        public double[] Times = [];
        public int NalLengthSize = 4;
        public int Count => Sizes.Length;

        public static SampleTable? Read(FileStream f)
        {
            var moov = FindTopLevel(f, "moov");
            if (moov == null) return null;
            foreach (var trak in Children(moov, 0, moov.Length).Where(b => b.Type == "trak"))
            {
                var mdia = Child(moov, trak, "mdia");
                if (mdia == null) continue;
                var hdlr = Child(moov, mdia.Value, "hdlr");
                if (hdlr == null || Encoding.ASCII.GetString(moov, hdlr.Value.Body + 8, 4) != "vide") continue;
                var mdhd = Child(moov, mdia.Value, "mdhd");
                var stbl = Child(moov, Child(moov, mdia.Value, "minf") ?? default, "stbl");
                if (mdhd == null || stbl == null) continue;
                return Build(moov, mdhd.Value, stbl.Value);
            }
            return null;
        }

        private static SampleTable? Build(byte[] m, Box mdhd, Box stbl)
        {
            var version = m[mdhd.Body];
            var timescale = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(mdhd.Body + (version == 1 ? 20 : 12)));
            if (timescale == 0) return null;
            var table = new SampleTable();

            if (Child(m, stbl, "stsd") is { } stsd)
            {
                // avcC's lengthSizeMinusOne says how many bytes prefix each NAL unit.
                var at = m.AsSpan(stsd.Body, stsd.End - stsd.Body).IndexOf("avcC"u8);
                if (at >= 0 && stsd.Body + at + 8 < m.Length) table.NalLengthSize = (m[stsd.Body + at + 8] & 3) + 1;
            }

            var stsz = Child(m, stbl, "stsz");
            if (stsz == null) return null;
            var fixedSize = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stsz.Value.Body + 4));
            var count = (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stsz.Value.Body + 8));
            if (count <= 0 || count > 1_000_000) return null;
            table.Sizes = new int[count];
            for (var i = 0; i < count; i++)
                table.Sizes[i] = fixedSize != 0 ? (int)fixedSize : (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stsz.Value.Body + 12 + i * 4));

            var chunkOffsets = new List<long>();
            if (Child(m, stbl, "stco") is { } stco)
            {
                var n = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stco.Body + 4));
                for (var i = 0; i < n; i++) chunkOffsets.Add(BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stco.Body + 8 + i * 4)));
            }
            else if (Child(m, stbl, "co64") is { } co64)
            {
                var n = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(co64.Body + 4));
                for (var i = 0; i < n; i++) chunkOffsets.Add((long)BinaryPrimitives.ReadUInt64BigEndian(m.AsSpan(co64.Body + 8 + i * 8)));
            }
            var stsc = Child(m, stbl, "stsc");
            if (chunkOffsets.Count == 0 || stsc == null) return null;
            var runs = (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stsc.Value.Body + 4));
            table.Offsets = new long[count];
            var sample = 0;
            for (var r = 0; r < runs && sample < count; r++)
            {
                var entry = stsc.Value.Body + 8 + r * 12;
                var firstChunk = (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(entry)) - 1;
                var perChunk = (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(entry + 4));
                var lastChunk = r + 1 < runs ? (int)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(entry + 12)) - 1 : chunkOffsets.Count;
                for (var c = firstChunk; c < lastChunk && c < chunkOffsets.Count && sample < count; c++)
                {
                    var pos = chunkOffsets[c];
                    for (var k = 0; k < perChunk && sample < count; k++)
                    {
                        table.Offsets[sample] = pos;
                        pos += table.Sizes[sample++];
                    }
                }
            }
            if (sample < count) return null;

            // Decode times from stts, shifted by ctts where frames are reordered.
            var stts = Child(m, stbl, "stts");
            if (stts == null) return null;
            var dts = new long[count];
            long t = 0;
            var s = 0;
            var entries = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stts.Value.Body + 4));
            for (var e = 0; e < entries && s < count; e++)
            {
                var n = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stts.Value.Body + 8 + e * 8));
                var delta = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(stts.Value.Body + 12 + e * 8));
                for (var k = 0; k < n && s < count; k++)
                {
                    dts[s++] = t;
                    t += delta;
                }
            }
            if (Child(m, stbl, "ctts") is { } ctts)
            {
                var cv = m[ctts.Body];
                var n = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(ctts.Body + 4));
                s = 0;
                for (var e = 0; e < n && s < count; e++)
                {
                    var c = BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(ctts.Body + 8 + e * 8));
                    var off = cv == 1 ? BinaryPrimitives.ReadInt32BigEndian(m.AsSpan(ctts.Body + 12 + e * 8))
                        : (long)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(ctts.Body + 12 + e * 8));
                    for (var k = 0; k < c && s < count; k++) dts[s++] += off;
                }
            }
            // The first frame shown is time zero, as in the browser's player.
            var first = dts.Min();
            table.Times = dts.Select(x => Math.Round((x - first) / (double)timescale, 3)).ToArray();
            return table;
        }

        private readonly record struct Box(string Type, int Body, int End);

        private static byte[]? FindTopLevel(FileStream f, string type)
        {
            long pos = 0;
            Span<byte> head = stackalloc byte[16];
            while (pos + 8 <= f.Length)
            {
                f.Position = pos;
                if (f.Read(head[..8]) != 8) return null;
                long size = BinaryPrimitives.ReadUInt32BigEndian(head);
                var name = Encoding.ASCII.GetString(head.Slice(4, 4));
                var headerSize = 8;
                if (size == 1)
                {
                    if (f.Read(head[8..16]) != 8) return null;
                    size = (long)BinaryPrimitives.ReadUInt64BigEndian(head[8..]);
                    headerSize = 16;
                }
                else if (size == 0) size = f.Length - pos;
                if (size < headerSize) return null;
                if (name == type)
                {
                    if (size > 64 * 1024 * 1024) return null;
                    var buffer = new byte[size - headerSize];
                    f.Position = pos + headerSize;
                    f.ReadExactly(buffer);
                    return buffer;
                }
                pos += size;
            }
            return null;
        }

        private static IEnumerable<Box> Children(byte[] m, int start, int end)
        {
            var pos = start;
            while (pos + 8 <= end)
            {
                var size = (long)BinaryPrimitives.ReadUInt32BigEndian(m.AsSpan(pos));
                var name = Encoding.ASCII.GetString(m, pos + 4, 4);
                if (size < 8 || pos + size > end) yield break;
                yield return new Box(name, pos + 8, (int)(pos + size));
                pos += (int)size;
            }
        }

        private static IEnumerable<Box> Children(byte[] m, Box parent) => Children(m, parent.Body, parent.End);

        private static Box? Child(byte[] m, Box parent, string type)
        {
            if (parent.End == 0) return null;
            foreach (var b in Children(m, parent))
                if (b.Type == type) return b;
            return null;
        }
    }
}
