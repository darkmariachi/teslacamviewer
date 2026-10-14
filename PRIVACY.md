# Privacy

TeslaCam Viewer has no accounts of its own, no analytics, no telemetry and no crash reporting. It does not
contact its authors or any service they run. Your clips stay on your own computer or server.

## What it connects to

- **Map tiles from OpenFreeMap (`tiles.openfreemap.org`)**, whenever a map is on screen. Your browser fetches
  the tiles for the area you are looking at, so OpenFreeMap sees your IP address and that area. Nothing else is
  sent.
- **GitHub (`github.com` and `api.github.com`), desktop app only**, to look for a newer version shortly after
  the app starts and, for the Windows installer and the AppImage, to download it. GitHub sees your IP address
  and that a copy of the app asked. Turn it off under Help → "Check for updates automatically"; after that it
  only happens when you choose "Check for updates".
- **Your teslausb device, only if you turn on teslausb** and enter its address. The app asks it for its status
  every 30 seconds, on your own network.
- **A webhook address, only if you enter one.** Each new Sentry event's time, place, reason and coordinates are
  sent there.

## What it stores

- **Your clips**, in the clip or library folder you chose. The app never changes them. It deletes them only
  when you delete or trim events (they go to a `.trash` folder first) or, when importing, when you ask it to
  clear the USB drive after copying.
- **An index of your library**, with notes, collections, favorites and settings, in `teslacam.db` in the data
  folder (`/data` in Docker, `%APPDATA%\TeslaCam Viewer\data` on Windows, `~/.config/TeslaCam Viewer/data` on
  Linux).
- **Thumbnails, merged videos and exports** in the data folder's `cache`.
- **The server version's password**, as a salted PBKDF2 hash. The desktop app has no password: it only answers
  requests from its own window on this computer.
- **The desktop app's logs**, in `logs` next to the data folder. They contain file names and errors, never the
  footage itself.

## What is in the footage

Dashcam and Sentry recordings show the people, cars and number plates around your car, and `event.json` holds
where the car was. Keep that in mind before sharing exports or putting the server on the internet: see
"Using it from a phone" in the app's Help for the safer ways to reach it from outside your home.
