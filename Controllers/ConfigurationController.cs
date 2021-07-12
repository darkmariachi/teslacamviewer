using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Data.DataModels;
using teslacamviewer.Data.Repositories;

namespace teslacamviewer.Controllers
{
    [Route("api/[controller]")]
    public class ConfigurationController: Controller
    {
        private readonly ITeslaConfigurationRepository _repo;
        public ConfigurationController(
            ITeslaConfigurationRepository repository
        ) 
        {
            _repo = repository;
        }

        [HttpGet]
        public async Task<IActionResult> Get() 
        {
            return Ok(await _repo.GetConfig());
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromBody] TeslaConfig config)
        {
            return Ok(await _repo.SaveConfig(config));
        }
    }
}