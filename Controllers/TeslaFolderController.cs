using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
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
            x.ForEach(tf => tf.TeslaClips = null);
            return Ok(x);
        }

        [HttpGet, Route("{folderName}")]
        public IActionResult GetTeslaFolder(string folderName) {
            return Ok(_mapper.Map<TeslaFolderContract>(_teslaFolderRepository.GetTeslaFolder(folderName)));
        }

        [HttpGet, Route("{folderName}/{fileName}")]
        public IActionResult GetTeslaClip(string folderName, string fileName) {
            return PhysicalFile($@"E:\TeslaCam\{folderName}\{fileName}", "application/octet-stream", fileName, enableRangeProcessing: true); // returns a FileStreamResult
        }

        [HttpGet, Route("get/thumbnail/{folderName}")]
        public async Task<IActionResult> GetThumbnail(string folderName) {
            var stream = await _teslaFolderRepository.GetThumbnail(folderName);
            
            if (stream == null)
                return NotFound();

            return File(stream, "application/octet-stream", "thumb.png");
        }
    }
}