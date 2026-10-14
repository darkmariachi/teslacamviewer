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
}
