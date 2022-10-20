using System;
using teslacamviewer.Enums;

namespace teslacamviewer.Contracts
{
    public class TeslaClipContract
    {
        public string Name {get;set;}
        public string ActualPath {get;set;}
        public DateTime DateTime {get;set;}
        public SideEnum Side {get;set;}
    }
}