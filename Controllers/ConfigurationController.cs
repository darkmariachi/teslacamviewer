using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Data.DataModels;
using teslacamviewer.Data.Repositories;
using teslacamviewer.Helpers;
using teslacamviewer.ViewModels;

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

        [HttpPost, Route("login")]
        public async Task<IActionResult> Login([FromBody] LoginViewModel login) {
            var isValid = await _repo.Login(login);
            if (isValid) {
                return Ok(JwtMiddleware.generateJwtToken());
            }
            return BadRequest("Invalid password.");
        }
    }
}