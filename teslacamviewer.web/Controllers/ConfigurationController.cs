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
            return Ok(await _repo.GetPublicConfig());
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

        [Authorize]
        [HttpPatch, Route("changePassword")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordViewModel changePassword)
        {
            if (!ModelState.IsValid) {
                return BadRequest(ModelState.ValidationState);
            }
            var validPassword = await _repo.ChangePassword(changePassword);
            return validPassword ? Ok() : BadRequest("Invalid password provided.");
        }

        [HttpDelete]
        [Authorize]
        public async Task<IActionResult> DeleteConfig()
        {
            await _repo.DeleteConfigs();
            return Ok(new { message = "Configurations have been deleted" });
        }

    }
}