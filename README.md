# TeslaCam Viewer

A self-hosted web app for browsing the Sentry and dashcam clips your Tesla records. Point it at the folder
where your clips are archived (for example by [teslausb](https://github.com/marcone/teslausb)) and it gives you
a fast, phone-friendly library with a synced multi-camera player.

> **v2** is a full rewrite (.NET 10, React, SQLite, ffmpeg). The original .NET 5 / Angular app is still
> available in the [earlier history](../../tree/152f739).

## What it does

- **Library** – every event as a card with a thumbnail, reason, city and time. Filter by type, reason, city and
  date, search, sort, and mark favorites.
- **Player** – one continuous timeline per event instead of one-minute files. All cameras play in sync; tap any
  camera to make it the main view. The moment that triggered the recording is marked, and playback starts just
  before it.
- **Merged videos** – ffmpeg combines the cameras into a single grid video, which is lighter to play on a phone
  and easy to share. Created automatically for recent events and on request for older ones.
- **Clip export** – select a range on the timeline and export it from one camera or as a grid.
- **Map** – all located events on a clustered map (MapLibre with OpenFreeMap tiles, no API key).
- **Collections and notes** – group events that belong together and write down what happened.
- **Insights** – events per month, by hour and weekday, by reason and by place.
- **Admin panel** – live view of the processing queue, per-step coverage, retry and cancel, pause, working
  hours, storage use, settings and password.
- **Safe deletion** – deleting moves clips to a `.trash` folder next to the originals. They can be restored
  until the retention period ends. A clean-up tool trashes old events while always keeping favorites and
  anything in a collection.
- **Six-camera cars** – pillar cameras are picked up automatically and laid out as a 3 × 2 grid.
- **HEVC** – clips in a codec browsers may not play get H.264 copies; the originals are never modified.
- **Webhook** – optional JSON POST when a new Sentry event arrives (handy for Home Assistant).

## Running it

```yaml
services:
  teslacamviewer:
    image: ghcr.io/darkmariachi/teslacamviewer:latest
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

Open `http://<host>:7544` and choose a password. First-time setup is only accepted from the local network, so
it is safe to put the app behind a reverse proxy before you have done it.

See [`docker-compose.example.yml`](docker-compose.example.yml) for a commented version.

### Folder layout

The mounted folder should look like what the car (or teslausb) writes:

```
/teslacam
├── SentryClips/2024-05-11_00-40-45/2024-05-11_00-30-18-front.mp4 …  event.json
├── SavedClips/…
└── RecentClips/…            (optional; grouped into drives)
```

A copy of the USB drive with a top-level `TeslaCam/` folder works too. `event.json` is optional; without it an
event simply has no reason, city or map location.

Mount the folder read-write if you want to delete from the app. Read-only works for viewing.

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `TESLACAM_ROOT` | `/teslacam` | Folder with the clips |
| `TESLACAM_DATA` | `/data` | Database, login keys and derived files |
| `TESLACAM_CACHE` | `$TESLACAM_DATA/cache` | Put thumbnails and merged videos on another disk |
| `TESLACAM_PASSWORD` | – | Preset the password on first start instead of using the setup screen |
| `TESLACAM_ALLOW_REMOTE_SETUP` | `false` | Allow first-time setup from outside the local network |
| `TZ` | UTC | Used for working hours and "recent" rules |

Everything else (merge policy and quality, working hours, scan interval, trash retention, webhook) is in the
Admin panel.

### Reverse proxy

The app trusts `X-Forwarded-For` and `X-Forwarded-Proto` from private addresses, so a proxy on the same host
or LAN works without extra configuration. Video is served with range requests; make sure the proxy does not
buffer whole responses.

## Development

```bash
# API on http://localhost:5283 (needs ffmpeg and ffprobe on the PATH)
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

`npm run build` writes the production bundle into `server/wwwroot`, which the server then serves itself.

## Keyboard shortcuts

`Space` play/pause · `←` `→` 5 seconds (with `Shift`: 1 second) · `1`–`6` choose camera · `G` merged view ·
`T` jump to the trigger · `F` full screen
