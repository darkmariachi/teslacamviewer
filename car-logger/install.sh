#!/bin/bash
# Installs car-logger on a teslausb Pi. Run as root on the Pi from a folder holding the
# arm64 car-logger binary and car-logger.service:
#   ./install.sh
# The key and VIN must already be in /mutable/tesla (see car-logger/README.md).
set -euo pipefail
cd "$(dirname "$0")"

for f in /mutable/tesla/private.pem /mutable/tesla/vin; do
  [ -f "$f" ] || { echo "Missing $f: pair a key with the car first." >&2; exit 1; }
done

install -m 700 car-logger /mutable/tesla/car-logger

# teslausb keeps the system disk read-only; the unit file is the only thing that lives there.
# A full teslausb re-setup may remove it; running this script again puts it back.
mount / -o remount,rw
install -m 644 car-logger.service /etc/systemd/system/car-logger.service
systemctl daemon-reload
systemctl enable car-logger.service
mount / -o remount,ro || echo "The system disk stays writable until the next reboot."

systemctl restart car-logger.service
echo "car-logger is running. Status: cat /mutable/car-log/status.json"
