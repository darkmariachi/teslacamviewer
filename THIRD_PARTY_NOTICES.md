# Third-party notices

TeslaCam Viewer is MIT licensed (see [LICENSE](LICENSE)). It is built on, and the desktop app and Docker image
include, the software below. Each is the work of its authors and is used under its own licence.

## Included in the desktop app

| Component | Licence | Source |
| --- | --- | --- |
| [FFmpeg](https://ffmpeg.org) (`ffmpeg` and `ffprobe`) | LGPL 2.1 or later | See below |
| [Electron](https://www.electronjs.org), including Chromium and Node.js | MIT; Chromium's own licences are listed in `LICENSES.chromium.html` next to the app | https://github.com/electron/electron |
| [electron-updater](https://www.electron.build/auto-update) | MIT | https://github.com/electron-userland/electron-builder |
| [.NET runtime and ASP.NET Core](https://dotnet.microsoft.com) | MIT | https://github.com/dotnet |
| [Entity Framework Core](https://learn.microsoft.com/ef/core/) | MIT | https://github.com/dotnet/efcore |
| [SQLite](https://sqlite.org) | Public domain | https://sqlite.org |
| [SQLitePCLRaw](https://github.com/ericsink/SQLitePCL.raw) | Apache 2.0 | https://github.com/ericsink/SQLitePCL.raw |

### FFmpeg

The desktop app ships an unmodified LGPL build of FFmpeg from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds),
the Windows and Linux builds linked from ffmpeg.org. The app runs it as a separate program and does not link
to it. `ffmpeg/SOURCE.txt` in the app's resources names the exact build. The source code of FFmpeg is at
https://github.com/FFmpeg/FFmpeg, and the build scripts that produced the binaries are at
https://github.com/BtbN/FFmpeg-Builds. You may replace the bundled `ffmpeg` and `ffprobe` with your own build.
FFmpeg's licensing is described at https://www.ffmpeg.org/legal.html.

The Docker image installs FFmpeg from Debian's package archive; its licence and source are available from
Debian (https://packages.debian.org/source/stable/ffmpeg).

## Included in the web app (all versions)

| Component | Licence |
| --- | --- |
| [React](https://react.dev) and React DOM | MIT |
| [React Router](https://reactrouter.com) | MIT |
| [TanStack Query](https://tanstack.com/query) | MIT |
| [MapLibre GL JS](https://maplibre.org) | BSD 3-Clause |
| [Lucide](https://lucide.dev) icons | ISC |
| [Inter](https://rsms.me/inter/) typeface | SIL Open Font License 1.1 |

## Map data

Map tiles are loaded from [OpenFreeMap](https://openfreemap.org), using the [OpenMapTiles](https://openmaptiles.org)
schema and data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the
Open Database License. The map shows this attribution.

## Not affiliated

TeslaCam Viewer is not affiliated with, or endorsed by, Tesla, Inc. or the teslausb project. "Tesla" is a
trademark of Tesla, Inc., used here only to say which cars the app works with.
