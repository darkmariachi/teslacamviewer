using System;

namespace teslacamviewer.Models
{
    public class TeslaEvent
    {
        public DateTime TimeStamp {get;set;}
        public string City {get;set;}
        public double Est_Lat {get;set;} 
        public double Est_Lon {get;set;}
        public string Reason {get;set;}

    }
}