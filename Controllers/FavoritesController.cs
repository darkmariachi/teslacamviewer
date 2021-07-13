using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using teslacamviewer.Data.Repositories;
using teslacamviewer.ViewModels;

namespace teslacamviewer.Controllers
{
    [Route("api/[controller]")]
    public class FavoritesController: Controller
    {
        private readonly IFavoritesRepository _repo;
        public FavoritesController(IFavoritesRepository repo) 
        {
            _repo = repo;
        }

        [Authorize]
        [HttpGet]
        public async Task<IActionResult> Get() 
        {
            return Ok(await _repo.GetFavorites());
        }

        [Authorize]
        [HttpPost]
        public async Task<IActionResult> Post([FromBody] ToggleFavoriteViewModel favorite) 
        {
            await _repo.ToggleFavorite(favorite.Name, favorite.Type);
            return Ok();
        }
    }
}