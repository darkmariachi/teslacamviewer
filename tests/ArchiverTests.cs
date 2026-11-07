using TeslaCam.Services;

namespace TeslaCam.Tests;

public class ArchiverTests
{
    // What teslausb's status.sh prints: a CGI header line, then JSON whose values are all strings.
    private const string StatusReport = """
        HTTP/1.0 200 OK
        Content-type: application/json

        {
           "cpu_temp": "52350",
           "fan_speed": "N/A",
           "external_5v": "4.8532",
           "throttled": "0x50005",
           "rtc_batt_v": "N/A",
           "num_snapshots": "12",
           "snapshot_oldest": "1760000000",
           "snapshot_newest": "1760003600",
           "total_space": "128000000000",
           "free_space": "64000000000",
           "uptime": "4521.33",
           "drives_active": "no",
           "wifi_ssid": "HomeNet",
           "wifi_freq": "5.18 GHz",
           "wifi_strength": "49/70",
           "wifi_ip": "192.168.1.60",
           "ether_ip": "",
           "ether_speed": ""
        }
        """;

    [Fact]
    public void Reads_a_teslausb_status_report()
    {
        var status = ArchiverService.ParseStatus(StatusReport);

        Assert.NotNull(status);
        Assert.Equal(52.4, status.CpuTempC!.Value, 1);
        Assert.Equal(0x50005, status.Throttled);
        Assert.Equal("HomeNet", status.WifiSsid);
        Assert.Equal(0.7, status.WifiStrength!.Value, 3);
        Assert.False(status.DrivesActive);
        Assert.Equal(64_000_000_000, status.FreeBytes);
        Assert.Equal(12, status.Snapshots);
        Assert.Null(status.FanRpm);
        Assert.Null(status.EtherIp);
        Assert.Equal(4.8532, status.SupplyVolts);
    }

    [Theory]
    [InlineData("<html>router login</html>")]
    [InlineData("{\"hello\":\"world\"}")]
    [InlineData("")]
    public void Rejects_answers_that_are_not_a_status_report(string body)
    {
        Assert.Null(ArchiverService.ParseStatus(body));
    }

    [Fact]
    public void Recognises_the_start_of_an_upload()
    {
        var n = ArchiverService.ParseNotification("Archiving 48 file(s) including 2 event folder(s) starting at Mon Oct 12 18:03:11 CDT 2026");

        Assert.Equal(new ArchiverNotification(true, 48, 2), n);
    }

    [Fact]
    public void Recognises_the_end_of_an_upload()
    {
        var n = ArchiverService.ParseNotification("Archived 48 files in 3 minutes, 12 seconds");

        Assert.Equal(new ArchiverNotification(false, 48, null), n);
    }

    [Fact]
    public void Ignores_unrelated_notifications()
    {
        Assert.Null(ArchiverService.ParseNotification("Temperature warning"));
    }

    // Shaped like teslausb's archiveloop.log: an upload that copied files, a later pass with nothing new,
    // and rsync's own unstamped lines mixed in.
    private const string Log = """
        e cut off mid-line by the partial read
        Mon Mar  2 05:20:11 PM CST 2026: Waiting for archive to be reachable...
        Mon Mar  2 05:21:40 PM CST 2026: Archive is reachable.
        Mon Mar  2 05:22:03 PM CST 2026: Archiving...
        Mon Mar  2 05:22:04 PM CST 2026: Mounted /mnt/archive.
        Mon Mar  2 05:22:04 PM CST 2026: There are 3 event folder(s) with 42 file(s) and 0 track mode file(s) to move.  0 short recording(s) will be skipped.
        Mon Mar  2 05:22:04 PM CST 2026: Archiving 42 file(s) including 3 event folder(s) starting at Mon Mar  2 05:22:04 PM CST 2026
        2026/03/02 17:22:05 [1133] building file list
        Mon Mar  2 05:24:10 PM CST 2026: Archiving completed successfully. Archived 42 files in 2m6s
        Mon Mar  2 05:24:12 PM CST 2026: Finished archiving.
        Mon Mar  2 05:24:17 PM CST 2026: Waiting for archive to be unreachable...
        Mon Mar  2 07:02:30 PM CST 2026: Archiving...
        Mon Mar  2 07:02:31 PM CST 2026: There are 0 event folder(s) with 0 file(s) and 0 track mode file(s) to move.  0 short recording(s) will be skipped.
        Mon Mar  2 07:02:33 PM CST 2026: Finished archiving.
        Mon Mar  2 07:02:38 PM CST 2026: Waiting for archive to be unreachable...
        """;

    [Fact]
    public void Reads_the_latest_pass_and_the_latest_copy_from_the_log()
    {
        var log = ArchiverLogParser.Parse(Log);

        Assert.Equal("done", log.State);
        Assert.Equal("nothing", log.LastRun!.Outcome);
        Assert.Equal(new DateTime(2026, 3, 2, 19, 2, 30), log.LastRun.StartedAt);
        Assert.Equal(0, log.LastRun.Files);
        Assert.Equal("done", log.LastCopy!.Outcome);
        Assert.Equal(42, log.LastCopy.Files);
        Assert.Equal(3, log.LastCopy.EventFolders);
        Assert.Equal(42, log.LastCopy.Archived);
        Assert.Equal(new DateTime(2026, 3, 2, 17, 24, 10), log.LastCopy.FinishedAt);
    }

    [Fact]
    public void Notices_an_upload_that_stopped_partway()
    {
        var log = ArchiverLogParser.Parse("""
            Tue Mar  3 18:29:47 CST 2026: Archiving...
            Tue Mar  3 18:29:47 CST 2026: There are 8 event folder(s) with 156 file(s) and 0 track mode file(s) to move.  0 short recording(s) will be skipped.
            Tue Mar  3 18:30:57 CST 2026: connection dead, killing archive-clips
            2026/03/03 18:30:57 [1133] rsync error: received SIGINT, SIGTERM, or SIGHUP (code 20) at rsync.c(713) [sender=3.2.7]
            Tue Mar  3 18:30:57 CST 2026: Error during archiving. Archived 17 files in 1m10s
            Tue Mar  3 18:31:02 CST 2026: Finished archiving.
            """);

        Assert.Equal("error", log.LastRun!.Outcome);
        Assert.Equal(17, log.LastRun.Archived);
        Assert.Equal(new DateTime(2026, 3, 3, 18, 29, 47), log.LastRun.StartedAt);
        Assert.Contains("connection dead, killing archive-clips", log.LastRun.Problems);

        var warnings = ArchiverLogParser.Warnings(log, true, DateTime.UtcNow, [], DateTime.UtcNow);
        var warning = Assert.Single(warnings);
        Assert.Contains("17 of 156 files", warning.Text);
        Assert.Equal("connection dead, killing archive-clips", warning.Detail);
    }

    [Fact]
    public void Warns_when_home_but_the_archive_share_is_unreachable()
    {
        var log = ArchiverLogParser.Parse("""
            Wed Mar  4 08:00:01 AM CST 2026: Starting archiveloop at 7.12 seconds uptime...
            Wed Mar  4 08:00:20 AM CST 2026: Waiting for archive to be reachable...
            Wed Mar  4 08:01:20 AM CST 2026: mount error: could not resolve address for nas: Unknown error
            Wed Mar  4 08:01:20 AM CST 2026: Retrying (1) 'archive_is_reachable' ...
            """);
        var now = DateTime.UtcNow;

        Assert.Equal("waitingForArchive", log.State);
        // Not straight away: the share often takes a minute to appear after the car arrives.
        Assert.Empty(ArchiverLogParser.Warnings(log, true, now.AddMinutes(-2), [], now));
        var warning = Assert.Single(ArchiverLogParser.Warnings(log, true, now.AddMinutes(-20), [], now));
        Assert.Equal("error", warning.Level);
        Assert.Contains("could not resolve address for nas", warning.Detail);
        // A stale log says nothing once the car has left.
        Assert.Empty(ArchiverLogParser.Warnings(log, false, now.AddMinutes(-20), [], now));
    }

    [Fact]
    public void Warns_about_power_dips_that_keep_happening()
    {
        var now = DateTime.UtcNow;
        ArchiverLogParser.VisitPower Visit(int id, bool dipped) => new(id, dipped);

        Assert.Empty(ArchiverLogParser.Warnings(null, false, null, [Visit(1, true), Visit(2, false), Visit(3, false)], now));
        var warning = Assert.Single(ArchiverLogParser.Warnings(null, false, null, [Visit(1, true), Visit(2, true), Visit(3, false)], now));
        Assert.Contains("2 of the last 3 visits", warning.Text);
    }
}
