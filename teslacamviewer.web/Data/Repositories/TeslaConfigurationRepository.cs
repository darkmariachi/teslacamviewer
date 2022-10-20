using System;
using System.Security.Cryptography;
using System.Threading.Tasks;
using AutoMapper;
using Microsoft.AspNetCore.Cryptography.KeyDerivation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using teslacamviewer.Contracts;
using teslacamviewer.Data.DataModels;
using teslacamviewer.ViewModels;

namespace teslacamviewer.Data.Repositories
{
    public interface ITeslaConfigurationRepository
    {
        Task<TeslaConfigPublicContract> GetPublicConfig();
        Task<TeslaConfig> SaveConfig(TeslaConfig config);
        Task<bool> Login(LoginViewModel login);
        Task<bool> ChangePassword(ChangePasswordViewModel changePassword);
        Task DeleteConfigs();
    }
    public class TeslaConfigurationRepository : ITeslaConfigurationRepository
    {
        private readonly TeslaContext _context;
        private readonly IConfiguration _configuration;
        private readonly IMapper _mapper;

        public TeslaConfigurationRepository(
            TeslaContext teslaContext,
            IConfiguration configuration,
            IMapper mapper
            )
        {
            _context = teslaContext;
            _configuration = configuration;
            _mapper = mapper;
        }
        public async Task<TeslaConfigPublicContract> GetPublicConfig()
        {
            var dbConfig = await _context.TeslaConfigs.FirstOrDefaultAsync();
            var result = _mapper.Map<TeslaConfigPublicContract>(dbConfig);
            if (result == null)
            {
                result = new TeslaConfigPublicContract { ConfigExists = false };
            } else
            {
                result.ConfigExists = true;              
            }
            result.IsAuthorizationEnabled = _configuration.GetValue<bool>("authorizationEnabled");
            return result;
        }

        public async Task<TeslaConfig> SaveConfig(TeslaConfig config)
        {
            var exists = await GetConfig();
            if (exists != null)
            {
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
            return await isValidPassword(login.Password);

        }

        public async Task<bool> ChangePassword(ChangePasswordViewModel changePassword)
        {
            if (!await isValidPassword(changePassword.Currentpassword))
            {
                return false;
            }
            var newSalt = GenerateSalt();
            var config = await _context.TeslaConfigs.FirstOrDefaultAsync();
            config.Password = Hash(changePassword.Newpassword, newSalt);
            config.Salt = Convert.ToBase64String(newSalt);
            await _context.SaveChangesAsync();
            return true;
        }
        
        public async Task DeleteConfigs()
        {
            _context.TeslaConfigs.RemoveRange(_context.TeslaConfigs);
            await _context.SaveChangesAsync();
        }

        private byte[] GenerateSalt()
        {
            byte[] salt = new byte[128 / 8];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(salt);
            }
            return salt;
        }

        private async Task<TeslaConfig> GetConfig()
        {
            return await _context.TeslaConfigs.FirstOrDefaultAsync();
        }

        private string Hash(string password, byte[] salt)
        {
            return Convert.ToBase64String(KeyDerivation.Pbkdf2(
            password: password,
            salt: salt,
            prf: KeyDerivationPrf.HMACSHA1,
            iterationCount: 10000,
            numBytesRequested: 256 / 8));
        }

        private async Task<bool> isValidPassword(string password)
        {
            var config = await GetConfig();
            if (config == null)
            {
                throw new Exception("Config has not been created");
            }
            var hashedProvidedPassword = Hash(password, Convert.FromBase64String(config.Salt));
            return (config.Password == hashedProvidedPassword);
        }
    }
}