using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using teslacamviewer.Helpers;
using teslacamviewer.Models;

namespace teslacamviewer.Services
{
    public interface ITeslaFolderRepository 
    {
        IEnumerable<TeslaFolder> GetTeslaFolders();
        TeslaFolder GetTeslaFolder(string folderName);
        Task<byte[]> GetTeslaClip(string folderName, string teslaClip);
        Task<byte[]> GetThumbnail(string folderName);
    }
    public class TeslaFolderRepository : ITeslaFolderRepository
    {
        private readonly IConfiguration _config;
        public TeslaFolderRepository(IConfiguration config) {
            _config = config;
            RootFolder = _config["rootFolder"];
        }
        private readonly string RootFolder;
        public IEnumerable<TeslaFolder> GetTeslaFolders()
        {
            var directories = Directory.GetDirectories(RootFolder);
            return BuildTeslaFolders(directories);
        }

        public TeslaFolder GetTeslaFolder(string folderName) {
            return BuildTeslaFolder(Path.Combine(RootFolder, folderName));
        }

        public async Task<byte[]> GetTeslaClip(string folderName, string teslaClip) {
            using (FileStream stream = File.OpenRead(Path.Combine(RootFolder, folderName, teslaClip))) {
                var result = new byte[stream.Length];
                await stream.ReadAsync(result, 0, (int)stream.Length);
                return result;
            }
        }

        public async Task<byte[]> GetThumbnail(string folderName) {
            using (FileStream stream = File.OpenRead(Path.Combine(RootFolder, folderName, "thumb.png"))) {
                var result = new byte[stream.Length];
                await stream.ReadAsync(result, 0, (int)stream.Length);
                return result;
            }
            
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
                        Thumbnail = TeslaFolderHelper.ContainsThumbnail(files, directory),
                    };
                }
                return null;
        }

        private TeslaEvent BuildTeslaEvent(string directory) {
            using (StreamReader r = new StreamReader(Path.Combine(directory, "event.json"))) 
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