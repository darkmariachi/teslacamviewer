using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using teslacamviewer.Enums;
using teslacamviewer.Models;

namespace teslacamviewer.Helpers
{
    public static class TeslaFolderHelper
    {
        public static string TeslaFolderPathParser(string fullPath) {
            var x = Path.DirectorySeparatorChar;
            var strings = fullPath.Split(Path.DirectorySeparatorChar);
            return strings[strings.Length - 1];
        }

        public static bool IsValidFolder(List<string> files, string directory) {

            return files.Contains(Path.Combine(directory, "event.json"));
        }

        public static bool ContainsThumbnail(List<string> files, string directory) {
            return files.Contains(Path.Combine(directory, "thumb.png"));
        }

        public static string TeslaClipPathParser(string fullPath) {
            var strings = fullPath.Split(Path.DirectorySeparatorChar);
            return strings[strings.Length - 1];
        }

        public static DateTime TeslaClipDateTimeParser(string fullPath) {
            var strings = fullPath.Split("_");
            var dateString = strings[0];
            var timeStrings = strings[1].Split("-"); 
            return Convert.ToDateTime($"{dateString}T{timeStrings[0]}:{timeStrings[1]}:{timeStrings[2]}");
        }

        public static SideEnum TeslaClipSideParser(string fullPath) {
            return Enum.Parse<SideEnum>(fullPath.Split("-").ToList().Last().Split(".").First().Split("_").First(), true);
        }
    }
}