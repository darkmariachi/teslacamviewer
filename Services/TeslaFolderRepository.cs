using System;
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
        TeslaFolder GetTeslaFolder(string folderName, string folderType);
        Task<byte[]> GetTeslaClip(string folderName, string teslaClip, string folderType);
        Task<byte[]> GetThumbnail(string folderName, string folderType);
    }
    public class TeslaFolderRepository : ITeslaFolderRepository
    {
        private readonly IConfiguration _config;
        private const string SENTRY_CLIPS_FOLDER_TYPE = "SentryClips";
        private const string SAVED_CLIPS_FOLDER_TYPE = "SavedClips";
        public TeslaFolderRepository(IConfiguration config) {
            _config = config;
            RootFolder = _config["rootFolder"];
        }
        private readonly string RootFolder;
        public IEnumerable<TeslaFolder> GetTeslaFolders()
        {
            ValidateFolders();
            var sentryDirectory = Directory.GetDirectories(Path.Join(RootFolder, SENTRY_CLIPS_FOLDER_TYPE));
            var savedClipsDirectory = Directory.GetDirectories(Path.Join(RootFolder, SAVED_CLIPS_FOLDER_TYPE));
            // var directories = Directory.GetDirectories(RootFolder);
            return BuildTeslaFolders(sentryDirectory, SENTRY_CLIPS_FOLDER_TYPE).Concat(BuildTeslaFolders(savedClipsDirectory, SAVED_CLIPS_FOLDER_TYPE));
        }

        public TeslaFolder GetTeslaFolder(string folderName, string folderType) {
            return BuildTeslaFolder(Path.Combine(RootFolder, folderType, folderName), folderType);
        }

        public async Task<byte[]> GetTeslaClip(string folderName, string teslaClip, string folderType) {
            using (FileStream stream = File.OpenRead(Path.Combine(RootFolder, folderType, folderName, teslaClip))) {
                var result = new byte[stream.Length];
                await stream.ReadAsync(result, 0, (int)stream.Length);
                return result;
            }
        }

        public async Task<byte[]> GetThumbnail(string folderName, string folderType) {
            using (FileStream stream = File.OpenRead(Path.Combine(RootFolder, folderType, folderName, "thumb.png"))) {
                var result = new byte[stream.Length];
                await stream.ReadAsync(result, 0, (int)stream.Length);
                return result;
            }
            
        }

        private IEnumerable<TeslaFolder> BuildTeslaFolders(string[] directories, string folderType) {
            return directories.Select(d => BuildTeslaFolder(d, folderType)).Where(t => t != null).ToList();
        }

        private TeslaFolder BuildTeslaFolder(string directory, string folderType) {
                var files = Directory.GetFiles(directory).ToList();
                if (TeslaFolderHelper.IsValidFolder(files, directory)) {
                    return new TeslaFolder 
                    {
                        ActualPath = directory, 
                        Name = TeslaFolderHelper.TeslaFolderPathParser(directory),
                        TeslaEvent = BuildTeslaEvent(directory),
                        TeslaClips = BuildTeslaClips(directory),
                        Thumbnail = TeslaFolderHelper.ContainsThumbnail(files, directory),
                        FolderType = folderType
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

        private void ValidateFolders() {
            if (!Directory.Exists(RootFolder) 
            || !Directory.Exists(Path.Join(RootFolder, SENTRY_CLIPS_FOLDER_TYPE)) 
            || !Directory.Exists(Path.Join(RootFolder, SAVED_CLIPS_FOLDER_TYPE))) {
                throw new Exception("The provided root teslacam directory does not exist.");
            }
        }
    }
}