using System;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Cryptography.KeyDerivation;
using Microsoft.EntityFrameworkCore;
using teslacamviewer.Data.DataModels;
using teslacamviewer.ViewModels;

namespace teslacamviewer.Data.Repositories
{
    public interface ITeslaConfigurationRepository
    {
        Task<TeslaConfig> GetConfig();
        Task<TeslaConfig> SaveConfig(TeslaConfig config);
        Task<bool> Login(LoginViewModel login);
    }
    public class TeslaConfigurationRepository : ITeslaConfigurationRepository
    {
        private readonly TeslaContext _context;
        public TeslaConfigurationRepository(TeslaContext teslaContext) 
        {
            _context = teslaContext;
        }
        public async Task<TeslaConfig> GetConfig()
        {
            return await _context.TeslaConfigs.FirstOrDefaultAsync();
        }

        public async Task<TeslaConfig> SaveConfig(TeslaConfig config) 
        {
            var exists = await GetConfig();
            if (exists != null) {
                throw new Exception("A config already exists.");
            }
            var salt = GenerateSalt();
            config.Salt = Convert.ToBase64String(salt);
            config.Password = Hash(config.Password, salt);
            _context.TeslaConfigs.Add(config);
            await _context.SaveChangesAsync();
            return config;
        }

        public async Task<bool> Login(LoginViewModel login) 
        {
            var config = await GetConfig();
            if (config == null) {
                return false;
            }
            return config.Password == Hash(login.Password, Convert.FromBase64String(config.Salt));
        }

        private byte[] GenerateSalt() {
            byte[] salt = new byte[128/8];
            using (var rng = RandomNumberGenerator.Create()) 
            {
                rng.GetBytes(salt);
            }
            return salt;
        }

        private string Hash(string password, byte[] salt) {
            return Convert.ToBase64String(KeyDerivation.Pbkdf2(
            password: password,
            salt: salt,
            prf: KeyDerivationPrf.HMACSHA1,
            iterationCount: 10000,
            numBytesRequested: 256 / 8));
        }
    }
}