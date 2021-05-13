using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using teslacamviewer.Helpers;
using teslacamviewer.Models;

namespace teslacamviewer.Services
{
    public interface ITeslaFolderRepository 
    {
        IEnumerable<TeslaFolder> GetTeslaFolders();
    }
    public class TeslaFolderRepository : ITeslaFolderRepository
    {
        private readonly string RootFolder = "E:\\TeslaCam";
        public IEnumerable<TeslaFolder> GetTeslaFolders()
        {
            var directories = Directory.GetDirectories(RootFolder);
            return BuildTeslaFolders(directories);
        }

        private IEnumerable<TeslaFolder> BuildTeslaFolders(string[] directories) {
            return directories.Select(d => BuildTeslaFolder(d)).Where(t => t != null).ToList();
        }

        private TeslaFolder BuildTeslaFolder(string directory) {
                var files = Directory.GetFiles(directory).ToList();
                if (TeslaFolderHelper.IsValidFolder(files, directory)) {
                    return new TeslaFolder 
                    {
                        ActualPath = directory, 
                        Name = TeslaFolderHelper.TeslaFolderPathParser(directory),
                        TeslaEvent = BuildTeslaEvent(directory),
                        TeslaClips = BuildTeslaClips(directory),
                    };
                }
                return null;
        }

        private TeslaEvent BuildTeslaEvent(string directory) {
            using (StreamReader r = new StreamReader($"{directory}\\event.json")) 
            {
                string json = r.ReadToEnd();
                return JsonConvert.DeserializeObject<TeslaEvent>(json);
            }
        }

        private IEnumerable<TeslaClip> BuildTeslaClips(string directory) {
            var files = Directory
            .GetFiles(directory)
            .Where(c => Regex.Match(c, @"([a-zA-Z0-9\s_\\.\-\(\):])+(mp4)$").Success)
            .ToList();

            return files.Select(f => 
                new TeslaClip 
                { 
                    Name = TeslaFolderHelper.TeslaClipPathParser(f),
                    ActualPath = f,
                    DateTime = TeslaFolderHelper.TeslaClipDateTimeParser(TeslaFolderHelper.TeslaClipPathParser(f)),
                    Side = TeslaFolderHelper.TeslaClipSideParser(f)
                });

        }
    }
}