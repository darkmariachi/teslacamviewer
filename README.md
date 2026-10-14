<div align="center">
  <img src="web/public/favicon.svg" height="120" width="120" alt="TeslaCam Viewer logo">

  <h1>TeslaCam Viewer</h1>

  <h3>Your Tesla's Sentry and dashcam clips, in a fast self-hosted library.</h3>

  <p>
    <img src="https://img.shields.io/badge/self--hosted-Docker-e82127" alt="Self-hosted with Docker">
    <img src="https://img.shields.io/badge/.NET-10-e82127" alt=".NET 10">
    <img src="https://img.shields.io/badge/React-19-e82127" alt="React 19">
    <img src="https://img.shields.io/badge/teslausb-optional-e82127" alt="teslausb optional">
  </p>
</div>

# Overview

TeslaCam Viewer turns the folder of clips your Tesla records into a library you can browse from any browser,
phone included. Every event becomes one continuous video with all cameras in sync, on a map, searchable, and
cleaned up for you when you want it to be.

It runs on your own server or NAS with Docker. Point it at the folder where your clips end up, whether you copy
the USB drive by hand or archive it automatically with [teslausb](https://github.com/marcone/teslausb).
Nothing leaves your network except map tiles.

> **v2** is a full rewrite (.NET 10, React, SQLite, ffmpeg). The original .NET 5 / Angular app is still
> available in the [earlier history](../../tree/152f739).

<p align="center">
  <img src="docs/screenshots/event.jpg" alt="An event: all four cameras in sync, the trigger marked on the timeline, and its place on a map" width="1000">
</p>

## Features

- Every Sentry event, saved clip and drive as a card with a thumbnail, reason, place and time
- One timeline per event instead of one-minute files, with every camera playing in sync and the trigger marked
- Hover a card to play the car's own few seconds around the trigger, on cars new enough to save them
- Merged grid videos that play well on a phone and are easy to share, plus clip export from any range
- Trim long Sentry events down to the minutes around the trigger
- A clustered map of where events happened, and insights by month, hour, weekday, reason and place
- Collections, notes and favorites
- Safe deletion through a trash folder next to your clips, restorable until it expires
- Optional [teslausb](https://github.com/marcone/teslausb) integration: see when the car is home, follow uploads,
  and clean up Sentry events recorded at home
- Hardware encoding on Intel graphics, with a software fallback
- No telemetry and no account besides your own password

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/home.jpg" alt="The library: events grouped by day with their type, reason and place"></td>
    <td width="50%"><img src="docs/screenshots/map.jpg" alt="Events clustered on a map"></td>
  </tr>
  <tr>
    <td align="center"><sub>The library, grouped by day</sub></td>
    <td align="center"><sub>Where events happened</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/insights.jpg" alt="Insights: events per month, activity by day, time of day and day of the week"></td>
    <td><img src="docs/screenshots/car.jpg" alt="The Car tab: teslausb's connection, uploads, Wi-Fi, storage and device health"></td>
  </tr>
  <tr>
    <td align="center"><sub>Insights across the whole library</sub></td>
    <td align="center"><sub>The car's teslausb device, from the home network</sub></td>
  </tr>
</table>

<sub>The footage, places and device in these screenshots are generated. Your library shows your own clips.</sub>

## Status

v2 is new. It is in use with a 2023 Model Y archived by teslausb on a Raspberry Pi 5; here is what has and has
not been tried.

| Area                                                          | State                                         |
| ------------------------------------------------------------- | --------------------------------------------- |
| Library, player, map, insights, collections, notes            | Works                                         |
| Merged videos, clip export, trimming                          | Works                                         |
| Deleting, trash and restoring                                 | Works                                         |
| The car's own event clip on hover                             | Works                                         |
| teslausb status, upload notifications and "Upload now"        | Works                                         |
| Cleaning up Sentry events recorded at home                    | Built and tested; new                         |
| Intel hardware encoding                                       | Built; falls back to software when missing    |
| Six-camera cars (pillar cameras)                              | Built; tried with generated clips only        |
| HEVC clips                                                    | Built; not yet tried with real HEVC footage   |
| Prebuilt Docker image for v2                                  | Published once v2 reaches `main`              |

If you try one of the rows that is not marked "Works", an issue saying how it went is very welcome.

## Contents

- [Status](#status) · [Requirements](#requirements) · [Install](#install) · [First run](#first-run) ·
  [Folder layout](#folder-layout)
- [Using it](#using-it) · [Keyboard shortcuts](#keyboard-shortcuts) · [teslausb](#teslausb) ·
  [Sentry at home](#sentry-at-home)
- [Settings](#settings) · [Reverse proxy](#reverse-proxy) · [Where things are stored](#where-things-are-stored) ·
  [Troubleshooting](#troubleshooting)
- [Relationship to other projects](#relationship-to-other-projects) · [Development](#development)

## Requirements

- A computer that stays on and runs Docker, such as a home server or NAS. It has been used on x86-64 Linux.
- The folder your clips are copied to. teslausb is optional; a copy of the USB drive works the same way.
- Disk space for derived files. Thumbnails are small; merged videos are smaller than the originals, and you
  choose which events get one.

ffmpeg is included in the image.

## Install

Until the v2 image is published, build it from a clone of this repository:

```bash
git clone -b v2 https://github.com/darkmariachi/teslacamviewer.git
cd teslacamviewer
cp docker-compose.example.yml docker-compose.yml   # then edit the paths, see below
docker compose up -d --build
```

The compose file:

```yaml
services:
  teslacamviewer:
    build: .                     # or, once published: image: ghcr.io/darkmariachi/teslacamviewer:latest
    container_name: teslacamviewer
    restart: unless-stopped
    user: "1000:1000"            # the user that owns the clips
    environment:
      - TZ=America/Chicago
    volumes:
      - /path/to/teslacam:/teslacam   # contains SentryClips/ and SavedClips/
      - ./data:/data                  # database, thumbnails, merged videos
    ports:
      - 7544:8080
    devices:                     # optional: Intel hardware encoding
      - /dev/dri:/dev/dri
    group_add:
      - "993"                    # host's render group id: getent group render
```

[`docker-compose.example.yml`](docker-compose.example.yml) has the same file with comments. Remove the
`devices` and `group_add` blocks if the machine has no Intel graphics.

## First run

1. Open `http://<host>:7544` and choose a password. First-time setup is only accepted from the local network,
   so it is safe to put the app behind a reverse proxy before you have done it.
2. The first scan starts straight away. Thumbnails come first, so the library is browsable within minutes even
   for thousands of events; reading clip details and merging videos carry on in the background.
3. Admin → Processing shows how far along it is. Admin → Settings sets which events get merged videos, the
   quality, and the hours heavy work is allowed to run.

## Folder layout

The mounted folder should look like what the car (or teslausb) writes:

```
/teslacam
├── SentryClips/2026-10-13_15-36-30/2026-10-13_15-35-32-front.mp4 …  event.json  event.mp4
├── SavedClips/…
└── RecentClips/…            (optional; grouped into drives)
```

A copy of the USB drive with a top-level `TeslaCam/` folder works too. `event.json` is optional; without it an
event simply has no reason, place or map location. Folders still being written are left alone for 90 seconds.

Mount the folder read-write if you want to delete or trim from the app. Read-only works for viewing.

## Using it

- **Library.** Filter by type, reason, place and date, search names, places and notes, and sort by date,
  length or size. "Select" applies favorites, collections, merging, trimming or deletion to many events at once.
- **Player.** Click any camera to make it the main view, or switch to the merged grid. Playback starts just
  before the trigger, which is marked on the timeline.
- **Exporting.** The scissors pick a range on the timeline; export it from one camera or as a grid.
- **Trimming.** Newer cars save ten minutes of lead-up with every Sentry event. An event's menu, or Trim in
  selection mode, keeps only the minutes around the trigger (two before and one after by default) and moves
  the rest to the trash folder.
- **Deleting.** Clips move to a `.trash` folder inside your clip folder and can be restored from Admin → Trash
  until the retention period ends (14 days by default). Admin → Trash can clear out old events in bulk while
  always keeping favorites and anything in a collection.
- **Webhook.** Admin → Settings can send a JSON POST to an address of your choice, such as a Home Assistant
  webhook, whenever a new Sentry event arrives.

## Keyboard shortcuts

| Key               | Action                         |
| ----------------- | ------------------------------ |
| `Space`           | Play / pause                   |
| `←` `→`           | 5 seconds back / forward       |
| `Shift` + `←` `→` | 1 second back / forward        |
| `1`–`6`           | Choose a camera                |
| `G`               | Merged view                    |
| `T`               | Jump to the trigger            |
| `F`               | Full screen                    |

## teslausb

The Car tab in Admin follows a [teslausb](https://github.com/marcone/teslausb) device without changing teslausb
itself:

1. In **Admin → Car**, enter the address of the teslausb web page (for example `http://teslausb.local`). The
   app polls its status report every 30 seconds; whenever it answers, the car is on the home network.
2. Copy the two lines shown there into `teslausb_setup_variables.conf` and re-run teslausb's setup:

   ```bash
   export WEBHOOK_ENABLED=true
   export WEBHOOK_URL=http://<server>:7544/api/archiver/hook/<token>
   ```

   teslausb then announces each upload as it starts and finishes, and the app rescans shortly after one ends.

The token in the webhook address is the only credential the car needs; the endpoint accepts nothing else
without a login. "Upload now" asks teslausb to start archiving immediately.

## Sentry at home

Cars cut power to their USB ports shortly after you walk away, which can stop teslausb in the middle of an
upload. Leaving Sentry on at home keeps the port powered, but records everyone who walks past.

1. Open an event recorded at home and choose **This is home** from its menu.
2. In Admin → Settings → Sentry at home, turn on the clean-up and pick how long to keep them (three days by
   default). The settings show how many events that covers before you save.

Sentry events within the radius of home then move to the trash once they are that old, and the webhook stops
announcing them. Favorites, events in a collection, saved clips and bumps (something touched the car) are always
kept.

## Settings

Set in the compose file:

| Variable                      | Default                | Purpose                                                    |
| ----------------------------- | ---------------------- | ---------------------------------------------------------- |
| `TESLACAM_ROOT`               | `/teslacam`            | Folder with the clips                                      |
| `TESLACAM_DATA`               | `/data`                | Database, login keys and derived files                     |
| `TESLACAM_CACHE`              | `$TESLACAM_DATA/cache` | Put thumbnails and merged videos on another disk           |
| `TESLACAM_PASSWORD`           | –                      | Preset the password on first start instead of the setup screen |
| `TESLACAM_ALLOW_REMOTE_SETUP` | `false`                | Allow first-time setup from outside the local network      |
| `TZ`                          | UTC                    | Used for working hours and "recent" rules                  |

Everything else is in Admin → Settings: merged videos (which events, resolution, quality, frame rate,
encoder), working hours, HEVC copies, scan interval, trash retention, trimming, Sentry at home and the webhook.

## Reverse proxy

The app trusts `X-Forwarded-For` and `X-Forwarded-Proto` from private addresses, so a proxy on the same host
or LAN works without extra configuration. Video is served with range requests; make sure the proxy does not
buffer whole responses.

## Where things are stored

Your clips are never modified. Everything the app makes lives in `/data`:

| Path                           | Contents                                                  |
| ------------------------------ | --------------------------------------------------------- |
| `teslacam.db`                  | The index, notes, collections, settings and job history   |
| `keys/`                        | Keys that sign login cookies                              |
| `cache/events/<id>/thumb.jpg`  | Thumbnails                                                |
| `cache/events/<id>/preview.mp4`| Merged grid videos                                        |
| `cache/events/<id>/event.mp4`  | Browser-playable copies of the car's own event clips      |
| `cache/events/<id>/t_<n>.mp4`  | H.264 copies of HEVC clips                                |
| `cache/exports/`               | Exported clips                                            |

Deleted and trimmed clips go to `.trash/` inside the clip folder, not to `/data`.

## Troubleshooting

**New clips don't show up.**
The folder is scanned every five minutes (Admin → Settings), and folders still being written are skipped for
90 seconds. Admin → Library → "Scan now" runs one immediately. Check that the mounted folder contains
`SentryClips`, `SavedClips` or `RecentClips`, or a `TeslaCam` folder that does.

**Deleting or trimming fails.**
The clip folder is mounted read-only, or the container runs as a user that can't write to it. Set `user:` to the
owner of the clips (`id -u` and `id -g` on the host).

**A clip doesn't play.**
Some cars record in HEVC, which not every browser plays. The event page offers "Make compatible copies", or set
Admin → Settings to make them automatically.

**Merging is slow.**
Without hardware encoding every merge runs on the processor. Pass `/dev/dri` through and add the host's
`render` group id (`getent group render`), or lower the merged video resolution. Working hours keep heavy work
to the night.

**The Car tab says the car is away.**
The app reaches teslausb only while the car is on the home network. If it is home, check that the address in
Admin → Car opens teslausb's web page from the server.

## Relationship to other projects

TeslaCam Viewer is an independent project. It is not affiliated with, or endorsed by, Tesla or the teslausb
project. It reads the files a Tesla writes and, if you set it up, talks to a teslausb device through the status
page and webhook teslausb already has.

- Video work is done by [ffmpeg](https://ffmpeg.org), included in the Docker image.
- The map uses [MapLibre](https://maplibre.org) with tiles from [OpenFreeMap](https://openfreemap.org), based
  on OpenStreetMap data. Map tiles are the only thing your browser fetches from outside your network.

## Development

Requires the .NET 10 SDK, Node 22 or newer, and ffmpeg and ffprobe on the `PATH`.

```bash
# API on http://localhost:5283
cd server
dotnet run

# Web app on http://localhost:5183, proxying /api to the server
cd web
npm install
npm run dev
```

Create `server/appsettings.Development.json` (git-ignored) to point at some sample clips:

```json
{ "TESLACAM_ROOT": "C:/clips/sample", "TESLACAM_DATA": "C:/clips/devdata" }
```

| Command                                  | What it does                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| `dotnet test`                            | Server tests, from the repository root                     |
| `npm run dev`                            | Web app with hot reload                                    |
| `npm run build`                          | Type-check and build the web app into `server/wwwroot`     |
| `npm run lint`                           | Lint the web app                                           |
| `docker compose up -d --build`           | Build and run the container                                |

### Layout

- `server/Api`: the HTTP endpoints, one file per area.
- `server/Services`: scanning, the job queue and ffmpeg work, trash and trimming, teslausb, home clean-up.
- `server/Data`: the SQLite model and its migrations.
- `web/src`: the React app; `pages/` per screen, `components/` shared, `api.ts` the typed client.
- `tests`: scanner, timeline, archiver and home clean-up tests against throwaway folders and databases.
