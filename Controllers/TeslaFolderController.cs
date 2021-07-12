using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AutoMapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using teslacamviewer.Contracts;
using teslacamviewer.Helpers;
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
        private readonly IConfiguration _config;
        public TeslaFolderController(
            ITeslaFolderRepository teslaFolderRepository,
            IMapper mapper,
            IConfiguration config) {
            _teslaFolderRepository = teslaFolderRepository;
            _mapper = mapper;
            _config = config;
        }

        [Authorize]
        [HttpGet]
        public IActionResult GetTeslaFolders() {
            var x = _mapper.Map<List<TeslaFolderContract>>(_teslaFolderRepository.GetTeslaFolders());
            x.ForEach(tf => tf.TeslaClips = null);
            return Ok(x);
        }

        [Authorize]
        [HttpGet, Route("{folderType}/{folderName}")]
        public IActionResult GetTeslaFolder(string folderType, string folderName) {
            return Ok(_mapper.Map<TeslaFolderContract>(_teslaFolderRepository.GetTeslaFolder(folderName, folderType)));
        }

        [Authorize]
        [HttpGet, Route("{folderType}/{folderName}/{fileName}")]
        public IActionResult GetTeslaClip(string folderType, string folderName, string fileName) {
            return PhysicalFile(Path.Combine(_config["rootFolder"], folderType, folderName, fileName), "application/octet-stream", fileName, enableRangeProcessing: true); // returns a FileStreamResult
        }

        [HttpGet, Route("get/thumbnail/{folderType}/{folderName}")]
        public async Task<IActionResult> GetThumbnail(string folderType, string folderName) {
            var stream = await _teslaFolderRepository.GetThumbnail(folderName, folderType);
            
            if (stream == null)
                return NotFound();

            return File(stream, "application/octet-stream", "thumb.png");
        }

        [Authorize]
        [HttpDelete, Route("{folderType}/{folderName}")]
        public IActionResult DeleteTeslaFolder(string folderType, string folderName) {
            _teslaFolderRepository.DeleteTeslaFolder(folderType, folderName);
            return Ok();
        }
    }
}