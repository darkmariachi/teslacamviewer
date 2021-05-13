using System;
using System.Collections.Generic;
using System.Linq;
using teslacamviewer.Models;

namespace teslacamviewer.Contracts
{
    public class TeslaFolderContract
    {
        public string Name {get;set;}
        public string ActualPath {get;set;}
        public string Thumbnail {get;set;}
        public IEnumerable<TeslaClipContract> TeslaClips {get;set;}
        public IEnumerable<IGrouping<DateTime, TeslaClipContract>> TeslaClipsGroupedByDate {get;set;}
    }
}