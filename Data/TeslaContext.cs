using System.IO;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using teslacamviewer.Data.DataModels;

namespace teslacamviewer.Data
{
    public class TeslaContext : DbContext
    {
        private readonly IConfiguration _config;
        public DbSet<TeslaConfig> TeslaConfigs {get;set;}
        public TeslaContext(IConfiguration config) {
            _config = config;
            Database.EnsureCreated();
        }

        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) {
            var dataSource = Path.Join($"Data Source={_config["SQLITEFOLDER"]}", "teslasql.db");
            optionsBuilder.UseSqlite(dataSource);
        }
    }
}