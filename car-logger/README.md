# car-logger

An optional program for the teslausb Raspberry Pi in the car. It reads the car's state over Bluetooth with a key
paired to the car, and writes it to log files on the Pi: battery and charging, location and speed while driving,
locks, doors and windows, climate, tire pressure and software updates. TeslaCam will collect the log when the car
gets home (not built yet).

It uses no cloud service and needs no Tesla account: it talks to the car the way a phone key does, using
Tesla's own [vehicle-command](https://github.com/teslamotors/vehicle-command) library.

**Status: experimental.** It runs on one car. We are still checking whether its readings keep the car awake
longer than it would otherwise stay, and how well the Bluetooth link holds while driving.

## How it reads

The car is in one of five modes, and each sets how often each kind of reading is taken:

| Mode     | When                                         | What it reads                                                     |
| -------- | -------------------------------------------- | ----------------------------------------------------------------- |
| driving  | In Drive, Reverse or Neutral                 | Location and speed every 15 s, battery every minute               |
| charging | Charging                                     | Charge every minute, the rest every 10 to 30 minutes              |
| parked   | Someone inside, or in use in the last 10 min | Gear every 30 s, charge and doors every 2 min                     |
| idle     | Awake, parked, nobody around                 | One full set every 30 minutes (`-idle-every`), and lets go between |
| asleep   | The car is asleep                            | Only the lock and sleep check, which never wakes the car          |

The Pi only has power while the car keeps its USB ports on, so the log has gaps while the car sleeps.

Records go to numbered [JSON Lines](https://jsonlines.org) files in `/mutable/car-log`, one reading per line,
each written to disk before the next because the car can cut the power at any moment. Every record carries the
car's own timestamp (`carTime`) as well as the Pi's (`piTime`): the Pi has no clock battery and only sets its
time on home Wi-Fi, so away from home its time is wrong. The log is capped at 150 MB, oldest files first.
`/mutable/car-log/status.json` shows the current mode, the last error and how many records were written.

## Setting it up

You need SSH access to the Pi as root, the car's VIN, and a key card.

1. Build the tools for the Pi (on any computer with Go):

   ```bash
   git clone --depth 1 --branch v0.4.1 https://github.com/teslamotors/vehicle-command
   cd vehicle-command
   GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o tesla-control ./cmd/tesla-control
   GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o tesla-keygen ./cmd/tesla-keygen
   ```

   and car-logger itself, from this folder:

   ```bash
   GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o car-logger .
   ```

2. Copy `tesla-control` and `tesla-keygen` to `/mutable/tesla/` on the Pi (only root should read that folder),
   then make a key and save the VIN there:

   ```bash
   cd /mutable/tesla
   ./tesla-keygen -key-file private.pem -output public.pem create
   echo YOUR_VIN > vin
   ```

3. Sit in the car with your key card and pair the key. `vehicle_monitor` is the role for reading state:

   ```bash
   ./tesla-control -ble -vin "$(cat vin)" add-key-request public.pem vehicle_monitor cloud_key
   ```

   Tap the card on the console and approve the new key on the screen. Check it works:

   ```bash
   ./tesla-control -ble -vin "$(cat vin)" -key-file private.pem state charge
   ```

4. Copy `car-logger`, `car-logger.service` and `install.sh` to a folder on the Pi and run `./install.sh` as
   root. It installs the service and starts it. A full teslausb re-setup may remove the service; run the script
   again to put it back.

To remove it: `systemctl disable --now car-logger`, delete `/mutable/tesla` and `/mutable/car-log`, and delete
the key on the car's Locks screen. Your phones and key cards are not affected.

## Privacy

This records where the car goes. The log stays on the Pi, inside the car, until TeslaCam collects it from your
own network. Anyone who can log in to the Pi as root can read it, and can use the key with the car.
