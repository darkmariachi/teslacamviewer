using System.Collections.Generic;
using System.Linq;
using AutoMapper;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Contracts;
using teslacamviewer.Models;
using teslacamviewer.Services;

namespace teslacamviewer.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TeslaFolderController: ControllerBase
    {
        private readonly ITeslaFolderRepository _teslaFolderRepository;
        private readonly IMapper _mapper;
        public TeslaFolderController(
            ITeslaFolderRepository teslaFolderRepository,
            IMapper mapper) {
            _teslaFolderRepository = teslaFolderRepository;
            _mapper = mapper;
        }

        [HttpGet]
        public IActionResult GetTeslaFolders() {
            var x = _mapper.Map<List<TeslaFolderContract>>(_teslaFolderRepository.GetTeslaFolders());
            return Ok(x);
        }
    }
}