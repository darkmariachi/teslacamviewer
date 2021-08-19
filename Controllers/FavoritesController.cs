using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AutoMapper;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Contracts;
using teslacamviewer.Data.Repositories;
using teslacamviewer.Helpers;
using teslacamviewer.Services;
using teslacamviewer.ViewModels;

namespace teslacamviewer.Controllers
{
    [Route("api/[controller]")]
    public class FavoritesController: Controller
    {
        private readonly IFavoritesRepository _favoritesRepo;
        private readonly ITeslaFolderRepository _teslaFolderRepository;
        private readonly IMapper _mapper;

        public FavoritesController(
            IFavoritesRepository favoritesRepo,
            ITeslaFolderRepository teslaFolderRepository,
            IMapper mapper
            ) 
        {
            _favoritesRepo = favoritesRepo;
            _teslaFolderRepository = teslaFolderRepository;
            _mapper = mapper;
        }

        [Authorize]
        [HttpGet]
        public async Task<IActionResult> Get() 
        {
            return Ok(await _favoritesRepo.GetFavorites());
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ToggleFavoriteViewModel favorite) 
        {
            await _favoritesRepo.ToggleFavorite(favorite.Name, favorite.Type);
            return Ok();
        }

        [Authorize]
        [HttpGet, Route("folders")]
        public async Task<IActionResult> GetFolders() 
        {
            var folders = _teslaFolderRepository.GetTeslaFolders();
            var folderFilter = (await _favoritesRepo.GetFavorites()).Where(f => f.Type == "Folder").ToList();
            var filteredFolders = folders.Where(f => folderFilter.Any(folder => folder.Name == f.Name)).ToList();
            var result = _mapper.Map<List<TeslaFolderContract>>(filteredFolders);
            result.ForEach(tf => tf.TeslaClips = null);
            return Ok(result);
        }
    }
}