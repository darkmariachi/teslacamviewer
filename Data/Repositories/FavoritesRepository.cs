using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using teslacamviewer.Data.DataModels;

namespace teslacamviewer.Data.Repositories
{
    public interface IFavoritesRepository 
    {
        Task<IEnumerable<Favorite>> GetFavorites();
        Task ToggleFavorite(string name, string type);
    }
    public class FavoritesRepository : IFavoritesRepository
    {
        private readonly TeslaContext _context;
        public FavoritesRepository(TeslaContext context) 
        {
            _context = context;
        }
        public async Task<IEnumerable<Favorite>> GetFavorites()
        {
            return await _context.Favorites.ToListAsync();
        }

        public async Task ToggleFavorite(string name, string type)
        {
            var fav = await GetFavorite(name, type);
            if (fav == null) 
            {
                _context.Favorites.Add(new Favorite { Type = type, Name = name });
            } else 
            {
                _context.Favorites.Remove(fav);
            }
             
            await _context.SaveChangesAsync();
        }

        public async Task<Favorite> GetFavorite(string name, string type) 
        {
            return await _context.Favorites.Where(f => f.Name == name && f.Type == type)
            .FirstOrDefaultAsync();
        }
    }
}