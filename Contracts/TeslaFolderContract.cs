using System;
using System.Collections.Generic;
using System.Linq;

namespace teslacamviewer.Contracts
{
    public class TeslaFolderContract
    {
        public string Name {get;set;}
        public string ActualPath {get;set;}
        public bool Thumbnail {get;set;}
        public TeslaEventContract TeslaEvent {get;set;}
        public IEnumerable<TeslaClipContract> TeslaClips {get;set;}
        public IEnumerable<IGrouping<DateTime, TeslaClipContract>> TeslaClipsGroupedByDate {get;set;}
    }
}