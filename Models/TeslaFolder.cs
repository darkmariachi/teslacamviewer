using System.Collections.Generic;

namespace teslacamviewer.Models
{
    public class TeslaFolder
    {
        public string Name {get;set;}
        public string ActualPath {get;set;}
        public TeslaEvent TeslaEvent {get;set;}
        public bool Thumbnail {get;set;}
        public IEnumerable<TeslaClip> TeslaClips {get;set;} = new List<TeslaClip>();
        public string FolderType {get;set;}
    }
}