using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Models;
using teslacamviewer.Services;

namespace teslacamviewer.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TeslaFolderController: ControllerBase
    {
        private readonly ITeslaFolderRepository _teslaFolderRepository;
        public TeslaFolderController(ITeslaFolderRepository teslaFolderRepository) {
            _teslaFolderRepository = teslaFolderRepository;
        }

        [HttpGet]
        public IActionResult GetTeslaFolders() {
            return Ok(_teslaFolderRepository.GetTeslaFolders());
        }
    }
}