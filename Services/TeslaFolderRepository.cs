using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using teslacamviewer.Models;

namespace teslacamviewer.Services
{
    public interface ITeslaFolderRepository 
    {
        IEnumerable<TeslaFolder> GetTeslaFolders();
    }
    public class TeslaFolderRepository : ITeslaFolderRepository
    {
        private readonly string RootFolder = "/home/rodolfo/Documents/testTeslaCamData";
        public IEnumerable<TeslaFolder> GetTeslaFolders()
        {
            var result = new List<TeslaFolder>();
            var directories = Directory.GetDirectories(RootFolder);
            foreach(var d in directories) {
                var files = Directory.GetFiles(d);
                if (files.Contains($"{d}/event.json")) {
                    result.Add(new TeslaFolder { Name = d });
                }
            }
            return result;
        }
    }
}