using System.Linq;
using AutoMapper;
using teslacamviewer.Data.DataModels;
using teslacamviewer.Models;

namespace teslacamviewer.Contracts
{
    public class MappingProfile: Profile
    {
        public MappingProfile() {
            CreateMap<TeslaFolder, TeslaFolderContract>()
            .AfterMap(
                (src, dest) => {
                     dest.TeslaClipsGroupedByDate = dest.TeslaClips.GroupBy(tc => tc.DateTime);
                });

            CreateMap<TeslaEvent, TeslaEventContract>();
            CreateMap<TeslaClip, TeslaClipContract>();
            CreateMap<TeslaConfig, TeslaConfigPublicContract>();
        }
    }
}