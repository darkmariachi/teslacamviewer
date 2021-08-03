using System;
using System.Collections.Generic;
using teslacamviewer.Enums;

namespace teslacamviewer.Models
{
    public class TeslaClip
    {
        public string Name {get;set;}
        public string ActualPath {get;set;}
        public DateTime? DateTime {get;set;}
        public SideEnum Side {get;set;}
    }
}