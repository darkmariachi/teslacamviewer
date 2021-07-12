using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using teslacamviewer.Data.DataModels;

namespace teslacamviewer.Data.Repositories
{
    public interface ITeslaConfigurationRepository
    {
        Task<TeslaConfig> GetConfig();
        Task<TeslaConfig> SaveConfig(TeslaConfig config);
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
            _context.TeslaConfigs.Add(config);
            await _context.SaveChangesAsync();
            return config;
        }
    }
}