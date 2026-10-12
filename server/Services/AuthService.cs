using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace TeslaCam.Services;

/// <summary>Single-password login with PBKDF2 hashing and a simple lockout against guessing.</summary>
public class AuthService(SettingsService settings)
{
    private const string HashKey = "passwordHash";
    private const int Iterations = 210_000;
    public const int MinPasswordLength = 8;

    private readonly ConcurrentDictionary<string, (int Failures, DateTime LockedUntilUtc)> _attempts = new();

    public async Task<bool> IsConfiguredAsync() => !string.IsNullOrEmpty(await settings.GetRawAsync(HashKey));

    public async Task SetPasswordAsync(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        await settings.SetRawAsync(HashKey, $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}");
    }

    public async Task<bool> VerifyAsync(string password)
    {
        var stored = await settings.GetRawAsync(HashKey);
        var parts = stored?.Split('$');
        if (parts is not { Length: 4 } || !int.TryParse(parts[1], out var iterations)) return false;
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Seconds the caller still has to wait, or 0 when a login attempt is allowed.</summary>
    public int LockedForSeconds(string client)
    {
        if (!_attempts.TryGetValue(client, out var a)) return 0;
        var remaining = (a.LockedUntilUtc - DateTime.UtcNow).TotalSeconds;
        return remaining > 0 ? (int)Math.Ceiling(remaining) : 0;
    }

    public void RecordFailure(string client)
    {
        _attempts.AddOrUpdate(client, _ => (1, DateTime.MinValue), (_, a) =>
        {
            var failures = a.Failures + 1;
            // Five free tries, then a wait that doubles up to 15 minutes.
            var wait = failures < 5 ? 0 : Math.Min(900, 30 * Math.Pow(2, failures - 5));
            return (failures, DateTime.UtcNow.AddSeconds(wait));
        });
    }

    public void RecordSuccess(string client) => _attempts.TryRemove(client, out _);
}
