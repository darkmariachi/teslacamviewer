using FluentAssertions;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using teslacamviewer.Helpers;
using Xunit;

namespace teslacamviewer.tests.Helpers
{
    public class TeslaFolderHelperTests
    {
        [Theory]
        [InlineData("E:\\TeslaCam\\2020-06-27_15-42-53")]
        public void IsValidFolderReturnsValidData(string directory)
        {
            var result = TeslaFolderHelper.IsValidFolder(directory);
            result.Should().BeTrue();
        }
    }
}
